import { afterEach, describe, expect, it, vi } from "vitest"
import { readGmailAttachment } from "../src/gmail-read"
import { applyGmailThreadAction, forwardGmail, replyGmail, sendGmail } from "../src/gmail-send"
import { readOutlookAttachment } from "../src/outlook-read"
import { applyOutlookThreadAction, forwardOutlook, replyOutlook, sendOutlook } from "../src/outlook-send"
import { createGmailProvider } from "../src/gmail"
import { createOutlookProvider } from "../src/outlook"
import { ProviderError, ReauthRequiredError } from "../src/provider"
import { replyRecipients, type MailThreadMessage } from "../src/types"

type Sent = { url: string; method: string; body: Record<string, unknown>; raw: string; contentType: string }

function stub(answer: (url: string) => [number, unknown] = () => [200, {}]) {
  const sent: Sent[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.method) {
        const raw = init.body as string
        const contentType = (init.headers as Record<string, string>)["Content-Type"] ?? ""
        sent.push({ url, method: init.method, raw, contentType, body: contentType.includes("json") ? JSON.parse(raw) : {} })
      }
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
const base = { from: me, to: [al], cc: [], bcc: [], subject: "Hello", text: "Body", attachments: [] }
const pdf = { name: "rapport é.pdf", contentType: "application/pdf", data: Buffer.from("PDF!").toString("base64") }

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
    await replyGmail("t", { from: me, messageId: "m1", threadId: "T", to: [al], cc: [], text: "Yes", attachments: [] })

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
    await replyGmail("t", { from: me, messageId: "m1", threadId: "T", to: [al], cc: [], text: "Yes", attachments: [] })
    expect(mime(sent).headers).toContain("Subject: RE: Plan")
  })
})

describe("gmail attachments", () => {
  const uploaded = (sent: Sent) => {
    const start = sent.raw.indexOf("Content-Type: message/rfc822")
    return sent.raw.slice(start)
  }

  it("sends files through the upload endpoint as multipart mime", async () => {
    const sent = stub()
    await sendGmail("t", { ...base, attachments: [pdf] })
    expect(sent[0]?.url).toContain("/upload/gmail/v1/users/me/messages/send?uploadType=multipart")
    expect(sent[0]?.contentType).toMatch(/^multipart\/related; boundary=/)
    const mimeText = uploaded(sent[0] as Sent)
    expect(mimeText).toMatch(/Content-Type: multipart\/mixed; boundary="evido_/)
    expect(mimeText).toContain("filename*=UTF-8''rapport%20%C3%A9.pdf")
    expect(mimeText).toContain(pdf.data)
  })

  it("keeps the proven JSON path when there are no files", async () => {
    const sent = stub()
    await sendGmail("t", base)
    expect(sent[0]?.url).toMatch(/\/messages\/send$/)
  })

  it("cannot be tricked through a file name, type or data", async () => {
    const sent = stub()
    await sendGmail("t", {
      ...base,
      attachments: [
        {
          name: 'x"\r\nBcc: victim@example.com',
          contentType: "text/html\r\nBcc: victim@example.com",
          data: `${pdf.data}\r\nBcc: victim@example.com`,
        },
      ],
    })
    const mimeText = uploaded(sent[0] as Sent)
    expect(mimeText.split("\r\n").some((line) => line.startsWith("Bcc:"))).toBe(false)
    expect(mimeText).toContain("Content-Type: application/octet-stream")
  })

  it("keeps the thread when replying with a file", async () => {
    const original = { id: "m1", payload: { headers: [{ name: "Subject", value: "Plan" }] } }
    const sent = stub((url) => (url.includes("/messages/m1") ? [200, original] : [200, {}]))
    await replyGmail("t", { from: me, messageId: "m1", threadId: "T", to: [al], cc: [], text: "Yes", attachments: [pdf] })
    expect(sent[0]?.raw).toContain('{"threadId":"T"}')
  })

  it("forwards the original with its attachments and leaves inline images out", async () => {
    const original = {
      id: "m1",
      internalDate: "1793000000000",
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "Subject", value: "Plan" }, { name: "From", value: "Al <al@example.com>" }, { name: "To", value: "me@example.com" }],
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("original text").toString("base64url") } },
          { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "file", size: 4 } },
          {
            mimeType: "image/png",
            filename: "logo.png",
            headers: [{ name: "Content-ID", value: "<l>" }, { name: "Content-Disposition", value: "inline" }],
            body: { attachmentId: "logo", size: 1 },
          },
        ],
      },
    }
    const requested: string[] = []
    const sent = stub((url) => {
      requested.push(url)
      if (url.includes("/attachments/file")) return [200, { data: Buffer.from("PDF!").toString("base64url") }]
      if (url.includes("/messages/m1")) return [200, original]
      return [200, {}]
    })
    await forwardGmail("t", { from: me, messageId: "m1", to: [bo], cc: [], text: "FYI" })

    expect(requested.some((url) => url.includes("/attachments/logo"))).toBe(false)
    const mimeText = uploaded(sent[0] as Sent)
    expect(mimeText).toContain("Subject: Fwd: Plan")
    expect(mimeText).toContain("filename*=UTF-8''a.pdf")
    expect(mimeText).toContain(Buffer.from("PDF!").toString("base64"))
    const text = Buffer.from(mimeText.split('charset="UTF-8"')[1]?.split("--evido")[0]?.split("\r\n\r\n")[1]?.replace(/\s/g, "") ?? "", "base64").toString("utf8")
    expect(text).toMatch(/^FYI\r\n\r\n---------- Forwarded message/)
    expect(text).toContain("original text")
  })

  it("reads an attachment as bytes", async () => {
    stub(() => [200, { data: Buffer.from("hello").toString("base64url") }])
    const bytes = await readGmailAttachment("t", { messageId: "m", attachmentId: "a" })
    expect(Buffer.from(bytes).toString()).toBe("hello")
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
    await replyOutlook("t", { messageId: "a/b", to: [al], cc: [bo], text: '<img src=x> & "hi"\nline', attachments: [] })
    expect(sent[0]?.url).toContain("/me/messages/a%2Fb/reply")
    expect(sent[0]?.body.comment).toBe("&lt;img src=x&gt; &amp; &quot;hi&quot;<br>line")
    expect(sent[0]?.body.message).toEqual({
      toRecipients: [{ emailAddress: { address: "al@example.com", name: "Doe, Al" } }],
      ccRecipients: [{ emailAddress: { address: "bo@example.com" } }],
    })
  })
})

describe("outlook attachments and forwarding", () => {
  it("attaches files to a new message and a reply", async () => {
    const sent = stub(() => [202, {}])
    await sendOutlook("t", { ...base, attachments: [pdf] })
    await replyOutlook("t", { messageId: "m", to: [al], cc: [], text: "Yes", attachments: [pdf] })
    const file = {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: pdf.name,
      contentType: pdf.contentType,
      contentBytes: pdf.data,
    }
    expect((sent[0]?.body.message as { attachments: unknown[] }).attachments).toEqual([file])
    expect((sent[1]?.body.message as { attachments: unknown[] }).attachments).toEqual([file])
  })

  it("forwards with escaped text and recipients at the top level", async () => {
    const sent = stub(() => [202, {}])
    await forwardOutlook("t", { messageId: "a/b", to: [al], cc: [bo], text: "<b>x</b>" })
    expect(sent[0]?.url).toContain("/me/messages/a%2Fb/forward")
    expect(sent[0]?.body.comment).toBe("&lt;b&gt;x&lt;/b&gt;")
    expect((sent[0]?.body.toRecipients as unknown[]).length).toBe(2)
    expect(sent[0]?.body.message).toBeUndefined()
  })

  it("reads file attachments and refuses items without file content", async () => {
    stub(() => [200, { contentBytes: Buffer.from("hello").toString("base64") }])
    expect(Buffer.from(await readOutlookAttachment("t", { messageId: "m", attachmentId: "a" })).toString()).toBe("hello")
    stub(() => [200, {}])
    await expect(readOutlookAttachment("t", { messageId: "m", attachmentId: "a" })).rejects.toBeInstanceOf(ProviderError)
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
    inline: [],
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

describe("change notifications", () => {
  const gmail = createGmailProvider({ clientId: "c", clientSecret: "s" })
  const outlook = createOutlookProvider({ clientId: "c", clientSecret: "s" })
  const input = { webhookUrl: "https://api/hook", gmailTopic: "projects/p/topics/t", clientState: "st", existingId: null }

  it("gmail watches the topic and reports Google's expiry", async () => {
    const sent = stub(() => [200, { historyId: "1", expiration: "1793000000000" }])
    const watch = await gmail.watch("t", input)
    expect(sent[0]?.url).toMatch(/\/users\/me\/watch$/)
    expect(sent[0]?.body).toEqual({ topicName: "projects/p/topics/t" })
    expect(watch).toEqual({ id: null, expiresAt: new Date(1793000000000) })
  })

  it("gmail refuses to watch without a topic", async () => {
    await expect(gmail.watch("t", { ...input, gmailTopic: null })).rejects.toBeInstanceOf(ProviderError)
  })

  it("outlook creates an inbox subscription with the client state", async () => {
    const sent = stub(() => [201, { id: "sub" }])
    const watch = await outlook.watch("t", input)
    expect(sent[0]?.method).toBe("POST")
    expect(sent[0]?.body).toMatchObject({
      resource: "me/mailFolders('inbox')/messages",
      notificationUrl: "https://api/hook",
      clientState: "st",
      changeType: "created,updated,deleted",
    })
    expect(watch.id).toBe("sub")
    expect(watch.expiresAt.getTime()).toBeLessThan(Date.now() + 7 * 86400000)
  })

  it("outlook renews an existing subscription", async () => {
    const sent = stub()
    expect((await outlook.watch("t", { ...input, existingId: "sub" })).id).toBe("sub")
    expect(sent).toHaveLength(1)
    expect(sent[0]?.method).toBe("PATCH")
    expect(sent[0]?.url).toMatch(/\/subscriptions\/sub$/)
  })

  it("outlook replaces a subscription Microsoft has dropped", async () => {
    const sent = stub((url) => (url.endsWith("/subscriptions/old") ? [404, {}] : [201, { id: "new" }]))
    expect((await outlook.watch("t", { ...input, existingId: "old" })).id).toBe("new")
    expect(sent.map((item) => item.method)).toEqual(["PATCH", "POST"])
  })
})
