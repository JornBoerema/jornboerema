import { afterEach, describe, expect, it, vi } from "vitest"
import { applyGmailThreadAction, replyGmail, sendGmail } from "../src/gmail-send"
import { applyOutlookThreadAction, replyOutlook, sendOutlook } from "../src/outlook-send"
import { ProviderError, ReauthRequiredError } from "../src/provider"
import { replyRecipients, type MailThreadMessage } from "../src/types"

type Sent = { url: string; method: string; body: Record<string, unknown> }

function stub(answer: (url: string) => [number, unknown] = () => [200, {}]) {
  const sent: Sent[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.method) sent.push({ url, method: init.method, body: JSON.parse(init.body as string) })
      const [status, body] = answer(url)
      return new Response(JSON.stringify(body), { status })
    })
  )
  return sent
}

afterEach(() => vi.unstubAllGlobals())

const me = { name: "Jörn", email: "me@example.com" }
const al = { name: "Doe, Al", email: "al@example.com" }
const bo = { name: null, email: "bo@example.com" }
const base = { from: me, to: [al], cc: [], bcc: [], subject: "Hello", text: "Body" }

function mime(sent: Sent[]) {
  const raw = Buffer.from(sent[0]?.body.raw as string, "base64url").toString("utf8")
  const split = raw.indexOf("\r\n\r\n")
  return { headers: raw.slice(0, split), body: Buffer.from(raw.slice(split + 4), "base64").toString("utf8") }
}

describe("gmail send", () => {
  it("builds a valid message with a quoted display name and utf-8 body", async () => {
    const sent = stub()
    await sendGmail("t", { ...base, text: "Héllo ✓" })
    const { headers, body } = mime(sent)
    expect(sent[0]?.url).toMatch(/\/messages\/send$/)
    expect(headers).toContain('To: "Doe, Al" <al@example.com>')
    expect(headers).toContain("Subject: Hello")
    expect(headers).toMatch(/^From: =\?UTF-8\?B\?/)
    expect(body).toBe("Héllo ✓")
  })

  it("cannot be tricked into adding headers", async () => {
    const sent = stub()
    await sendGmail("t", {
      ...base,
      subject: "Hi\r\nBcc: victim@example.com",
      to: [{ name: "X\r\nBcc: victim@example.com", email: "al@example.com" }],
    })
    const { headers } = mime(sent)
    expect(headers.split("\r\n").some((line) => line.startsWith("Bcc:"))).toBe(false)
  })

  it("refuses a malformed recipient instead of sending it", async () => {
    const sent = stub()
    await expect(
      sendGmail("t", { ...base, to: [{ name: null, email: "a@b.c>\r\nBcc: x@y.z" }] })
    ).rejects.toBeInstanceOf(ProviderError)
    expect(sent).toEqual([])
  })

  it("encodes long non-ascii subjects in RFC 2047 sized words", async () => {
    const sent = stub()
    await sendGmail("t", { ...base, subject: "é".repeat(100) })
    const lines = mime(sent).headers.split("\r\n")
    const start = lines.findIndex((line) => line.startsWith("Subject:"))
    const words = lines.slice(start).filter((line) => line.includes("=?UTF-8?B?"))
    expect(words.length).toBeGreaterThan(1)
    expect(words.every((line) => line.trim().replace("Subject: ", "").length <= 75)).toBe(true)
  })

  it("threads a reply and quotes the original as plain text", async () => {
    const original = {
      id: "m1",
      internalDate: "1793000000000",
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "Subject", value: "Plan" },
          { name: "From", value: "Al <al@example.com>" },
          { name: "Message-ID", value: "<orig@mail>" },
          { name: "References", value: "<older@mail>" },
        ],
        body: {
          data: Buffer.from("<style>p{}</style><p>Tom &amp; Jerry</p><script>x()</script>").toString("base64url"),
        },
      },
    }
    const sent = stub((url) => (url.includes("/messages/m1") ? [200, original] : [200, {}]))
    await replyGmail("t", { from: me, messageId: "m1", threadId: "T", to: [al], cc: [], text: "Yes" })

    const { headers, body } = mime(sent)
    expect(sent[0]?.body.threadId).toBe("T")
    expect(headers).toContain("Subject: Re: Plan")
    expect(headers).toContain("In-Reply-To: <orig@mail>")
    expect(headers).toContain("References: <older@mail> <orig@mail>")
    expect(body).toMatch(/^Yes\r\n\r\nOn /)
    expect(body).toContain("> Tom & Jerry")
    expect(body).not.toContain("x()")
    expect(body).not.toContain("<p>")
  })

  it("does not stack Re: on a subject that already has it", async () => {
    const original = { id: "m1", payload: { headers: [{ name: "Subject", value: "RE: Plan" }] } }
    const sent = stub((url) => (url.includes("/messages/m1") ? [200, original] : [200, {}]))
    await replyGmail("t", { from: me, messageId: "m1", threadId: "T", to: [al], cc: [], text: "Yes" })
    expect(mime(sent).headers).toContain("Subject: RE: Plan")
  })
})

describe("gmail actions", () => {
  const input = { threadId: "T", messageIds: ["a", "b"] }

  it.each([
    ["read", { removeLabelIds: ["UNREAD"] }],
    ["unread", { addLabelIds: ["UNREAD"] }],
    ["archive", { removeLabelIds: ["INBOX"] }],
  ] as const)("%s changes labels on the inbox messages", async (action, change) => {
    const sent = stub()
    await applyGmailThreadAction("t", { ...input, action })
    expect(sent[0]?.url).toMatch(/\/messages\/batchModify$/)
    expect(sent[0]?.body).toEqual({ ids: ["a", "b"], ...change })
  })

  it("trashes, never permanently deletes", async () => {
    const sent = stub()
    await applyGmailThreadAction("t", { ...input, action: "trash" })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toMatch(/\/threads\/T\/trash$/)
  })
})

describe("outlook send", () => {
  it("sends plain text and keeps a copy in Sent", async () => {
    const sent = stub(() => [202, {}])
    await sendOutlook("t", { ...base, bcc: [bo] })
    expect(sent[0]?.url).toMatch(/\/me\/sendMail$/)
    expect(sent[0]?.body).toMatchObject({
      saveToSentItems: true,
      message: {
        subject: "Hello",
        body: { contentType: "Text", content: "Body" },
        toRecipients: [{ emailAddress: { address: "al@example.com", name: "Doe, Al" } }],
        bccRecipients: [{ emailAddress: { address: "bo@example.com" } }],
      },
    })
  })

  it("escapes reply text and sends to exactly the shown recipients", async () => {
    const sent = stub(() => [202, {}])
    await replyOutlook("t", { messageId: "a/b", to: [al], cc: [bo], text: '<img src=x> & "hi"\nline' })
    expect(sent[0]?.url).toContain("/me/messages/a%2Fb/reply")
    expect(sent[0]?.body.comment).toBe("&lt;img src=x&gt; &amp; &quot;hi&quot;<br>line")
    expect(sent[0]?.body.message).toEqual({
      toRecipients: [{ emailAddress: { address: "al@example.com", name: "Doe, Al" } }],
      ccRecipients: [{ emailAddress: { address: "bo@example.com" } }],
    })
  })
})

describe("outlook actions", () => {
  it("patches read state per message", async () => {
    const sent = stub()
    await applyOutlookThreadAction("t", { messageIds: ["a", "b"], action: "unread" })
    expect(sent.map((item) => [item.method, item.body])).toEqual([
      ["PATCH", { isRead: false }],
      ["PATCH", { isRead: false }],
    ])
  })

  it.each([
    ["archive", "archive"],
    ["trash", "deleteditems"],
  ] as const)("%s moves to %s", async (action, destinationId) => {
    const sent = stub()
    await applyOutlookThreadAction("t", { messageIds: ["a"], action })
    expect(sent[0]?.url).toMatch(/\/me\/messages\/a\/move$/)
    expect(sent[0]?.body).toEqual({ destinationId })
  })

  it("treats an already removed message as done but surfaces other failures", async () => {
    stub(() => [404, {}])
    await expect(applyOutlookThreadAction("t", { messageIds: ["a"], action: "trash" })).resolves.toBeUndefined()
    stub(() => [503, {}])
    await expect(applyOutlookThreadAction("t", { messageIds: ["a"], action: "trash" })).rejects.toBeInstanceOf(ProviderError)
    stub(() => [401, {}])
    await expect(applyOutlookThreadAction("t", { messageIds: ["a"], action: "trash" })).rejects.toBeInstanceOf(ReauthRequiredError)
  })
})

describe("reply recipients", () => {
  const message = (overrides: Partial<MailThreadMessage>): MailThreadMessage => ({
    id: "m",
    subject: "",
    from: al,
    replyTo: [],
    to: [{ name: null, email: "ME@example.com" }, bo],
    cc: [{ name: null, email: "cc@example.com" }, al],
    receivedAt: "",
    html: null,
    text: null,
    attachments: [],
    ...overrides,
  })

  it("replies to the sender only", () => {
    expect(replyRecipients(message({}), "me@example.com", false)).toEqual({ to: [al], cc: [] })
  })

  it("prefers Reply-To", () => {
    const list = { name: null, email: "list@example.com" }
    expect(replyRecipients(message({ replyTo: [list] }), "me@example.com", false).to).toEqual([list])
  })

  it("reply all leaves out yourself and duplicates, case-insensitively", () => {
    expect(replyRecipients(message({}), "me@example.com", true)).toEqual({
      to: [al, bo],
      cc: [{ name: null, email: "cc@example.com" }],
    })
  })

  it("replying to your own message goes to its original recipients", () => {
    const own = message({ from: { name: null, email: "me@example.com" }, to: [al], cc: [] })
    expect(replyRecipients(own, "me@example.com", false).to).toEqual([al])
  })
})
