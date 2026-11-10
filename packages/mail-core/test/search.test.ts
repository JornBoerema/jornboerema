import { afterEach, describe, expect, it, vi } from "vitest"
import { listGmailFolder, searchGmail } from "../src/gmail-search"
import { listOutlookFolder, searchOutlook } from "../src/outlook-search"
import { rankSearchHits, searchWords, type MailSearchHit } from "../src/types"

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
        to: [],
        receivedAt: new Date(2000).toISOString(),
        isRead: false,
        isStarred: false,
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

describe("ranking", () => {
  const hit = (threadId: string, fields: Partial<MailSearchHit>): MailSearchHit => ({
    accountId: "a",
    threadId,
    subject: "",
    snippet: "",
    fromName: null,
    fromEmail: null,
    receivedAt: "2026-11-01T00:00:00Z",
    isRead: true,
    hasAttachments: false,
    ...fields,
  })

  it("puts sender matches before subject matches before mentions in the text", () => {
    const ranked = rankSearchHits("instagram", [
      hit("footer", { fromName: "DeAutoUnie", receivedAt: "2026-11-10T12:00:00Z" }),
      hit("subject", { subject: "Je Instagram-account", receivedAt: "2026-11-09T00:00:00Z" }),
      hit("old", { fromName: "Instagram", receivedAt: "2026-11-01T00:00:00Z" }),
      hit("new", { fromEmail: "no-reply@mail.instagram.com", receivedAt: "2026-11-10T00:00:00Z" }),
      hit("new", { fromName: "duplicate" }),
    ])
    expect(ranked.map((item) => item.threadId)).toEqual(["new", "old", "subject", "footer"])
  })

  it("ignores operators when ranking", () => {
    expect(searchWords("from:al Offerte  has:attachment")).toEqual(["offerte"])
  })
})

describe("folders", () => {
  it("read Gmail labels, with spam and trash asked for explicitly", async () => {
    const urls = stub((url) =>
      url.includes("/threads?")
        ? [200, { threads: [{ id: "t1" }], nextPageToken: "p2" }]
        : [200, { id: "t1", messages: [{ id: "m1", labelIds: ["SENT", "STARRED"], internalDate: "5", payload: { headers: [header("To", "Al <al@x.nl>")] } }] }]
    )
    const page = await listGmailFolder("t", { folder: "trash", pageToken: "p1" })
    const params = new URL(urls[0] as string).searchParams
    expect([params.get("labelIds"), params.get("includeSpamTrash"), params.get("pageToken")]).toEqual(["TRASH", "true", "p1"])
    expect(page.nextPageToken).toBe("p2")
    expect(page.hits[0]).toMatchObject({ isStarred: true, to: [{ name: "Al", email: "al@x.nl" }] })
    await listGmailFolder("t", { folder: "archive", pageToken: null })
    expect(new URL(urls.at(-2) as string).searchParams.get("q")).toContain("-in:inbox")
  })

  it("read Graph folders newest first, and flagged mail as starred", async () => {
    const urls = stub(() => [200, { value: [{ conversationId: "c1", flag: { flagStatus: "flagged" }, receivedDateTime: "2026-01-01T00:00:00Z" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }])
    const sent = await listOutlookFolder("t", { folder: "sent", pageToken: null })
    expect(urls[0]).toContain("/mailFolders/sentitems/messages")
    expect(decodeURIComponent(urls[0] as string)).toContain("$orderby=receivedDateTime desc")
    expect(sent).toMatchObject({ hits: [{ threadId: "c1", isStarred: true }], nextPageToken: "https://graph.microsoft.com/v1.0/next" })
    await listOutlookFolder("t", { folder: "starred", pageToken: null })
    expect(decodeURIComponent(urls[1] as string)).toContain("flag/flagStatus eq 'flagged'")
    await expect(listOutlookFolder("t", { folder: "sent", pageToken: "https://evil.example/x" })).rejects.toThrow()
  })

  it("treat a mailbox without an archive folder as empty", async () => {
    stub(() => [404, {}])
    expect(await listOutlookFolder("t", { folder: "archive", pageToken: null })).toEqual({ hits: [], nextPageToken: null })
  })
})
