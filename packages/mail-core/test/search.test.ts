import { afterEach, describe, expect, it, vi } from "vitest"
import { searchGmail } from "../src/gmail-search"
import { searchOutlook } from "../src/outlook-search"

function stub(answer: (url: string) => [number, unknown]) {
  const urls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url)
      const [status, body] = answer(url)
      return new Response(JSON.stringify(body), { status })
    })
  )
  return urls
}

afterEach(() => vi.unstubAllGlobals())

const header = (name: string, value: string) => ({ name, value })

describe("gmail search", () => {
  it("passes Gmail's own query through, without drafts, and describes each conversation", async () => {
    const urls = stub((url) => {
      if (url.includes("/threads?")) return [200, { threads: [{ id: "t1" }, { id: "gone" }] }]
      if (url.includes("/threads/gone")) return [404, {}]
      return [
        200,
        {
          id: "t1",
          messages: [
            { id: "m1", labelIds: ["INBOX"], internalDate: "1000", payload: { headers: [header("Subject", "Offerte"), header("From", "Al <al@x.nl>")] } },
            { id: "m2", labelIds: ["UNREAD"], snippet: "Prima &amp; dank", internalDate: "2000", payload: { mimeType: "multipart/mixed", headers: [header("Subject", "Re: Offerte"), header("From", '"Bo, B" <bo@x.nl>')] } },
            { id: "m3", labelIds: ["DRAFT"], internalDate: "3000", payload: { headers: [header("From", "me@x.nl")] } },
          ],
        },
      ]
    })
    const hits = await searchGmail("t", "from:al has:attachment")
    expect(new URL(urls[0] as string).searchParams.get("q")).toBe("from:al has:attachment -in:draft")
    expect(hits).toEqual([
      {
        threadId: "t1",
        subject: "Offerte",
        snippet: "Prima & dank",
        fromName: "Bo, B",
        fromEmail: "bo@x.nl",
        receivedAt: new Date(2000).toISOString(),
        isRead: false,
        hasAttachments: true,
      },
    ])
  })
})

describe("outlook search", () => {
  it("groups by conversation and leaves out drafts, junk and trash", async () => {
    const urls = stub((url) => {
      if (url.includes("mailFolders/deleteditems")) return [200, { id: "trash" }]
      if (url.includes("mailFolders/junkemail")) return [200, { id: "junk" }]
      return [
        200,
        {
          value: [
            { conversationId: "c1", subject: "Hi", bodyPreview: "a", from: { emailAddress: { name: "Al", address: "al@x.nl" } }, receivedDateTime: "2026-11-10T10:00:00Z", isRead: false, parentFolderId: "inbox" },
            { conversationId: "c1", subject: "Hi again", parentFolderId: "inbox" },
            { conversationId: "c2", isDraft: true, parentFolderId: "drafts" },
            { conversationId: "c3", parentFolderId: "junk" },
          ],
        },
      ]
    })
    const hits = await searchOutlook("t", 'say "hi"')
    expect(decodeURIComponent(urls.find((url) => url.includes("$search")) ?? "")).toContain('$search="say  hi"&')
    expect(hits.map((hit) => hit.threadId)).toEqual(["c1"])
    expect(hits[0]).toMatchObject({ subject: "Hi", fromEmail: "al@x.nl", isRead: false })
  })

  it("asks nothing for a query of only quotes", async () => {
    const urls = stub(() => [200, {}])
    expect(await searchOutlook("t", '""')).toEqual([])
    expect(urls).toHaveLength(0)
  })
})
