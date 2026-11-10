import { afterEach, describe, expect, it, vi } from "vitest"
import { deleteGmailDraft, getGmailDraft, listGmailDrafts, saveGmailDraft, sendGmailDraft } from "../src/gmail-drafts"
import {
  deleteOutlookDraft,
  getOutlookDraft,
  listOutlookDrafts,
  saveOutlookDraft,
  sendOutlookDraft,
} from "../src/outlook-drafts"
import { ProviderError } from "../src/provider"
import { isDraftWorthKeeping } from "../src/types"

type Sent = { url: string; method: string; body: Record<string, unknown>; raw: string; contentType: string }

function stub(answer: (url: string, method: string) => [number, unknown] = () => [200, {}]) {
  const sent: Sent[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET"
      if (method !== "GET") {
        const raw = (init.body as string) ?? ""
        const contentType = (init.headers as Record<string, string>)["Content-Type"] ?? ""
        sent.push({ url, method, raw, contentType, body: contentType.includes("json") && raw ? JSON.parse(raw) : {} })
      }
      const [status, body] = answer(url, method)
      return new Response(status === 204 ? null : JSON.stringify(body), { status })
    })
  )
  return sent
}

afterEach(() => vi.unstubAllGlobals())

const me = { name: null, email: "me@example.com" }
const al = { name: "Al", email: "al@example.com" }
const content = { to: [al], cc: [], bcc: [], subject: "Plan", text: "Hi", html: "<p>Hi</p>", attachments: [] }
const pdf = { name: "a.pdf", contentType: "application/pdf", data: Buffer.from("PDF!").toString("base64") }
const b64 = (value: string) => Buffer.from(value).toString("base64url")

describe("draft rule", () => {
  it("needs a subject or text, not just recipients", () => {
    expect(isDraftWorthKeeping({ subject: "", text: "" })).toBe(false)
    expect(isDraftWorthKeeping({ subject: "  ", text: "\n" })).toBe(false)
    expect(isDraftWorthKeeping({ subject: "Hi", text: "" })).toBe(true)
    expect(isDraftWorthKeeping({ subject: "", text: "Hi" })).toBe(true)
  })
})

describe("gmail drafts", () => {
  it("creates, then replaces the same draft", async () => {
    const sent = stub(() => [200, { id: "r1" }])
    expect(await saveGmailDraft("t", { ...content, from: me, draftId: null })).toBe("r1")
    expect(await saveGmailDraft("t", { ...content, from: me, draftId: "r1" })).toBe("r1")
    expect(sent.map((item) => `${item.method} ${item.url}`)).toEqual([
      "POST https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      "PUT https://gmail.googleapis.com/gmail/v1/users/me/drafts/r1",
    ])
    const message = sent[0]?.body.message as { raw: string }
    expect(Buffer.from(message.raw, "base64url").toString()).toContain("Subject: Plan")
  })

  it("uploads drafts with files and keeps a reply in its conversation", async () => {
    const sent = stub(() => [200, { id: "r2" }])
    await saveGmailDraft("t", {
      ...content,
      attachments: [pdf],
      reply: { threadId: "th1", inReplyTo: "<a@b>", references: "<a@b>" },
      from: me,
      draftId: "r2",
    })
    expect(sent[0]?.url).toBe("https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts/r2?uploadType=multipart")
    expect(sent[0]?.method).toBe("PUT")
    expect(sent[0]?.raw).toContain('{"message":{"threadId":"th1"}}')
    expect(sent[0]?.raw).toContain("In-Reply-To: <a@b>")
    expect(sent[0]?.raw).toContain("multipart/mixed")
  })

  it("lists drafts and skips ones that vanished meanwhile", async () => {
    stub((url) => {
      if (url.includes("/drafts?")) return [200, { drafts: [{ id: "r1" }, { id: "gone" }] }]
      if (url.includes("/drafts/gone")) return [404, {}]
      return [
        200,
        {
          id: "r1",
          message: {
            id: "m1",
            snippet: "Hi &amp; bye",
            internalDate: "1700000000000",
            payload: { headers: [{ name: "To", value: '"Doe, Al" <al@example.com>, bo@example.com' }, { name: "Subject", value: "Plan" }] },
          },
        },
      ]
    })
    expect(await listGmailDrafts("t")).toEqual([
      {
        id: "r1",
        subject: "Plan",
        snippet: "Hi & bye",
        to: [
          { name: "Doe, Al", email: "al@example.com" },
          { name: null, email: "bo@example.com" },
        ],
        updatedAt: new Date(1700000000000).toISOString(),
        hasAttachments: false,
      },
    ])
  })

  it("opens a draft with its files and reply headers", async () => {
    stub((url) => {
      if (url.includes("/attachments/")) return [200, { data: b64("PDF!") }]
      return [
        200,
        {
          id: "r1",
          message: {
            id: "m1",
            threadId: "th1",
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "To", value: "al@example.com" },
                { name: "Subject", value: "Re: Plan" },
                { name: "In-Reply-To", value: "<x@y>" },
              ],
              parts: [
                { mimeType: "text/plain", body: { data: b64("Hi") } },
                { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "att1", size: 4 } },
              ],
            },
          },
        },
      ]
    })
    const draft = await getGmailDraft("t", "r1")
    expect(draft).toMatchObject({ id: "r1", subject: "Re: Plan", text: "Hi", reply: { threadId: "th1", inReplyTo: "<x@y>" } })
    expect(draft.attachments).toEqual([{ name: "a.pdf", contentType: "application/pdf", data: Buffer.from("PDF!").toString("base64") }])
  })

  it("sends and deletes by draft id; a draft that is already gone is fine", async () => {
    const sent = stub((_url, method) => (method === "DELETE" ? [404, {}] : [200, {}]))
    await sendGmailDraft("t", "r1")
    await deleteGmailDraft("t", "r1")
    expect(sent[0]?.body).toEqual({ id: "r1" })
    expect(sent[1]?.method).toBe("DELETE")
  })
})

describe("outlook drafts", () => {
  it("creates with files, then patches without re-uploading them", async () => {
    const sent = stub(() => [200, { id: "o1" }])
    expect(await saveOutlookDraft("t", { ...content, attachments: [pdf], draftId: null, attachmentsChanged: true })).toBe("o1")
    expect(sent[0]?.body).toMatchObject({ subject: "Plan", body: { contentType: "HTML" }, attachments: [{ name: "a.pdf" }] })
    await saveOutlookDraft("t", { ...content, attachments: [pdf], draftId: "o1", attachmentsChanged: false })
    expect(sent.slice(1).map((item) => item.method)).toEqual(["PATCH"])
  })

  it("swaps files but keeps inline images when the files changed", async () => {
    const sent = stub((url, method) =>
      method === "GET" && url.includes("/attachments")
        ? [200, { value: [{ id: "f1", isInline: false }, { id: "img", isInline: true }] }]
        : [method === "DELETE" ? 204 : 200, {}]
    )
    await saveOutlookDraft("t", { ...content, attachments: [pdf], draftId: "o1", attachmentsChanged: true })
    expect(sent.map((item) => `${item.method} ${item.url.split("/me/messages/")[1]}`)).toEqual([
      "PATCH o1",
      "DELETE o1/attachments/f1",
      "POST o1/attachments",
    ])
  })

  it("lists and opens drafts", async () => {
    stub((url) =>
      url.includes("mailFolders/drafts")
        ? [200, { value: [{ id: "o1", subject: "Plan", bodyPreview: "Hi", toRecipients: [{ emailAddress: { address: "al@example.com", name: "Al" } }], lastModifiedDateTime: "2026-11-10T10:00:00Z", hasAttachments: true }] }]
        : [200, { id: "o1", subject: "Plan", body: { contentType: "html", content: "<p>Hi</p>" }, attachments: [{ id: "a", name: "a.pdf", contentType: "application/pdf", contentBytes: pdf.data }, { id: "i", isInline: true, contentBytes: "x" }] }]
    )
    expect((await listOutlookDrafts("t"))[0]).toMatchObject({ id: "o1", to: [al], hasAttachments: true })
    expect(await getOutlookDraft("t", "o1")).toMatchObject({ html: "<p>Hi</p>", text: "", attachments: [pdf] })
  })

  it("sends with an empty body and only deletes real drafts", async () => {
    let isDraft = true
    const sent = stub((_url, method) => (method === "GET" ? [200, { isDraft }] : [method === "DELETE" ? 204 : 202, {}]))
    await sendOutlookDraft("t", "o1")
    expect(sent[0]?.raw).toBe("")
    await deleteOutlookDraft("t", "o1")
    expect(sent[1]?.method).toBe("DELETE")
    isDraft = false
    await expect(deleteOutlookDraft("t", "inbox-mail")).rejects.toBeInstanceOf(ProviderError)
    expect(sent).toHaveLength(2)
  })
})
