import { afterEach, describe, expect, it, vi } from "vitest"
import { readGmailThread } from "../src/gmail-read"
import { folderOf, syncGmailPage } from "../src/gmail-sync"
import { readOutlookThread } from "../src/outlook-read"
import { GRAPH_BASE, syncOutlookPage } from "../src/outlook-sync"
import { isRateLimited, ProviderError, SyncCursorExpiredError } from "../src/provider"

const since = new Date("2026-08-01T00:00:00Z")

type Route = [pattern: RegExp, status: number, body: unknown]

/** Answers by the first matching URL pattern and records what was requested. */
function stubRoutes(routes: Route[]) {
  const requests: { url: string; headers: Record<string, string> }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, headers: init.headers as Record<string, string> })
      const route = routes.find(([pattern]) => pattern.test(url))
      if (!route) throw new Error(`Unexpected request: ${url}`)
      return new Response(JSON.stringify(route[2]), { status: route[1] })
    })
  )
  return requests
}

afterEach(() => vi.unstubAllGlobals())

function gmailMessage(id: string, labelIds = ["INBOX", "UNREAD"]) {
  return {
    id,
    threadId: `t-${id}`,
    labelIds,
    snippet: "Tom &amp; Jerry&#39;s",
    internalDate: "1793000000000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: '"Doe, Jo" <jo@example.com>' },
        { name: "To", value: '"Doe, Al" <al@example.com>, bo@example.com' },
        { name: "Subject", value: "Hi\u0000 there" },
      ],
    },
  }
}

const v2 = (cursor: object) => JSON.stringify({ v: 2, ...cursor })

describe("gmail folders", () => {
  it("maps labels to one folder", () => {
    expect(folderOf(["INBOX", "UNREAD"])).toBe("inbox")
    expect(folderOf(["SENT"])).toBe("sent")
    expect(folderOf(["INBOX", "SENT"])).toBe("inbox")
    expect(folderOf(["CATEGORY_UPDATES"])).toBe("archive")
    expect(folderOf(["SPAM", "INBOX"])).toBe("spam")
    expect(folderOf(["TRASH", "SENT"])).toBe("trash")
    expect(folderOf(["DRAFT"])).toBeNull()
    expect(folderOf(["CHAT"])).toBeNull()
  })
})

describe("gmail sync", () => {
  it("takes the history id before listing every folder, and maps metadata", async () => {
    const requests = stubRoutes([
      [/\/profile$/, 200, { historyId: "50" }],
      [/\/messages\?/, 200, { messages: [{ id: "a" }, { id: "d" }], nextPageToken: "next" }],
      [/\/messages\/a\?/, 200, gmailMessage("a")],
      [/\/messages\/d\?/, 200, gmailMessage("d", ["DRAFT"])],
    ])
    const page = await syncGmailPage("t", { cursor: null, since })

    expect(requests[0]?.url).toMatch(/\/profile$/)
    const list = new URL(requests[1]?.url ?? "").searchParams
    expect(list.get("q")).toBe(`after:${since.getTime() / 1000}`)
    expect(list.get("includeSpamTrash")).toBe("true")
    expect(list.get("labelIds")).toBeNull()
    expect(page.done).toBe(false)
    expect(JSON.parse(page.cursor)).toEqual({ v: 2, historyId: "50", pageToken: "next", backfill: true })
    expect(page.upserts).toHaveLength(1)
    expect(page.upserts[0]).toMatchObject({
      providerMessageId: "a",
      threadId: "t-a",
      folder: "inbox",
      to: [{ name: "Doe, Al", email: "al@example.com" }, { name: null, email: "bo@example.com" }],
      subject: "Hi there",
      snippet: "Tom & Jerry's",
      fromName: "Doe, Jo",
      fromEmail: "jo@example.com",
      isRead: false,
      isStarred: false,
      hasAttachments: true,
    })
  })

  it("switches to history after the last backfill page, without claiming done", async () => {
    stubRoutes([[/\/messages\?/, 200, {}]])
    const page = await syncGmailPage("t", { cursor: v2({ historyId: "50", pageToken: "p", backfill: true }), since })
    expect(page.done).toBe(false)
    expect(JSON.parse(page.cursor)).toEqual({ v: 2, historyId: "50", backfill: false })
  })

  it("keeps messages that left the inbox, in their new folder", async () => {
    stubRoutes([
      [
        /\/history\?/,
        200,
        {
          historyId: "60",
          history: [
            {
              messagesAdded: [{ message: { id: "new" } }, { message: { id: "draft" } }],
              labelsRemoved: [{ message: { id: "archived" } }],
              labelsAdded: [{ message: { id: "gone" } }, { message: { id: "deleted" } }],
              messagesDeleted: [{ message: { id: "deleted" } }],
            },
          ],
        },
      ],
      [/\/messages\/new\?/, 200, gmailMessage("new")],
      [/\/messages\/draft\?/, 200, gmailMessage("draft", ["DRAFT"])],
      [/\/messages\/archived\?/, 200, gmailMessage("archived", ["CATEGORY_UPDATES"])],
      [/\/messages\/gone\?/, 404, {}],
    ])
    const page = await syncGmailPage("t", { cursor: v2({ historyId: "50", backfill: false }), since })
    expect(page.done).toBe(true)
    expect(page.upserts.map((item) => [item.providerMessageId, item.folder])).toEqual([
      ["new", "inbox"],
      ["archived", "archive"],
    ])
    expect(page.removals.sort()).toEqual(["deleted", "draft", "gone"])
    expect(JSON.parse(page.cursor).historyId).toBe("60")
  })

  it("starts over from expired history, unreadable cursors and cursors from before folders", async () => {
    stubRoutes([[/\/history\?/, 404, {}]])
    await expect(syncGmailPage("t", { cursor: v2({ historyId: "1", backfill: false }), since })).rejects.toBeInstanceOf(
      SyncCursorExpiredError
    )
    await expect(syncGmailPage("t", { cursor: "nonsense", since })).rejects.toBeInstanceOf(SyncCursorExpiredError)
    await expect(
      syncGmailPage("t", { cursor: JSON.stringify({ historyId: "1", backfill: false }), since })
    ).rejects.toBeInstanceOf(SyncCursorExpiredError)
  })

  it("recognizes throttling from the reason Google sends, after trying again", async () => {
    vi.useFakeTimers()
    const cursor = v2({ historyId: "1", backfill: false })
    const requests = stubRoutes([[/\/history\?/, 403, { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } }]])
    const result = syncGmailPage("t", { cursor, since }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(8000)
    expect(isRateLimited(await result)).toBe(true)
    expect(requests).toHaveLength(4)
    vi.useRealTimers()
    stubRoutes([[/\/history\?/, 403, { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } }]])
    expect(isRateLimited(await syncGmailPage("t", { cursor, since }).catch((e: unknown) => e))).toBe(false)
  })

  it("does not treat other failures as an expired cursor", async () => {
    stubRoutes([[/\/history\?/, 400, {}]])
    await expect(syncGmailPage("t", { cursor: v2({ historyId: "1", backfill: false }), since })).rejects.toBeInstanceOf(
      ProviderError
    )
  })
})

const graphMessage = (id: string) => ({
  id,
  conversationId: `c-${id}`,
  subject: "Hello",
  bodyPreview: "Preview",
  from: { emailAddress: { name: "Jo", address: "jo@example.com" } },
  toRecipients: [{ emailAddress: { name: "Al", address: "al@example.com" } }],
  receivedDateTime: "2026-10-01T10:00:00Z",
  isRead: true,
  flag: { flagStatus: "flagged" },
  hasAttachments: false,
})

const FOLDER_NAMES = ["inbox", "sentitems", "archive", "junkemail", "deleteditems"]
const next = (folder: string) => `${GRAPH_BASE}/me/mailFolders/${folder}/messages/delta?$skiptoken=x`
const delta = (folder: string) => `${GRAPH_BASE}/me/mailFolders/${folder}/messages/delta?$deltatoken=y`
const cursorOf = (links: Record<string, string>, pending: string[]) => JSON.stringify({ v: 2, links, pending })

describe("outlook sync", () => {
  it("asks again after a passing server fault", async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++
        return calls === 1
          ? new Response(JSON.stringify({ error: { code: "UnknownError" } }), { status: 503 })
          : new Response(JSON.stringify({ value: [graphMessage("a")], "@odata.nextLink": next("inbox") }), { status: 200 })
      })
    )
    const page = syncOutlookPage("t", { cursor: null, since })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await page).upserts).toHaveLength(1)
    expect(calls).toBe(2)
    vi.useRealTimers()
  })

  it("starts with the inbox, from the window, with immutable ids", async () => {
    const requests = stubRoutes([[/\/delta/, 200, { value: [graphMessage("a")], "@odata.nextLink": next("inbox") }]])
    const page = await syncOutlookPage("t", { cursor: null, since })

    const first = decodeURIComponent(requests[0]?.url ?? "")
    expect(first).toContain("/mailFolders/inbox/messages/delta")
    expect(first).toContain(`receivedDateTime ge ${since.toISOString()}`)
    expect(first).toContain("receivedDateTime desc")
    expect(requests[0]?.headers.Prefer).toContain('IdType="ImmutableId"')
    expect(JSON.parse(page.cursor)).toEqual({ v: 2, links: { inbox: next("inbox") }, pending: FOLDER_NAMES })
    expect(page).toMatchObject({ done: false, removals: [], removalFolder: "inbox" })
    expect(page.upserts[0]).toMatchObject({
      threadId: "c-a",
      folder: "inbox",
      to: [{ name: "Al", email: "al@example.com" }],
      isRead: true,
      isStarred: true,
    })
  })

  it("moves to the next folder once one reaches its delta link", async () => {
    const requests = stubRoutes([
      [
        /\/delta/,
        200,
        {
          "@odata.deltaLink": delta("inbox"),
          value: [
            { id: "removed", "@removed": { reason: "deleted" } },
            { id: "partial", isRead: true },
            { id: "vanished", isRead: true },
          ],
        },
      ],
      [/\/messages\/partial\?/, 200, graphMessage("partial")],
      [/\/messages\/vanished\?/, 404, {}],
    ])
    const page = await syncOutlookPage("t", { cursor: cursorOf({ inbox: next("inbox") }, FOLDER_NAMES), since })

    expect(requests[0]?.url).toBe(next("inbox"))
    expect(JSON.parse(page.cursor)).toEqual({ v: 2, links: { inbox: delta("inbox") }, pending: FOLDER_NAMES.slice(1) })
    expect(page.done).toBe(false)
    expect(page.upserts.map((item) => item.providerMessageId)).toEqual(["partial"])
    expect(page.removals.sort()).toEqual(["removed", "vanished"])
  })

  it("syncs a later folder into its own folder, and is done after the last one", async () => {
    stubRoutes([[/\/delta/, 200, { value: [graphMessage("t")], "@odata.deltaLink": delta("deleteditems") }]])
    const page = await syncOutlookPage("t", { cursor: cursorOf({ inbox: delta("inbox") }, ["deleteditems"]), since })
    expect(page).toMatchObject({ done: true, removalFolder: "trash" })
    expect(page.upserts[0]?.folder).toBe("trash")

    // The next round catches every folder up again, from its stored link.
    const requests = stubRoutes([[/\/delta/, 200, { value: [], "@odata.deltaLink": delta("inbox") }]])
    await syncOutlookPage("t", { cursor: page.cursor, since })
    expect(requests[0]?.url).toBe(delta("inbox"))
  })

  it("treats a missing archive folder as caught up", async () => {
    stubRoutes([[/\/delta/, 404, {}]])
    const page = await syncOutlookPage("t", { cursor: cursorOf({}, ["archive", "junkemail"]), since })
    expect(JSON.parse(page.cursor).pending).toEqual(["junkemail"])
    expect(page.upserts).toEqual([])
  })

  it("keeps only the last state when an id appears twice", async () => {
    stubRoutes([
      [/\/delta/, 200, { "@odata.deltaLink": delta("inbox"), value: [graphMessage("a"), { id: "a", "@removed": { reason: "deleted" } }] }],
    ])
    const page = await syncOutlookPage("t", { cursor: cursorOf({}, FOLDER_NAMES), since })
    expect(page.upserts).toEqual([])
    expect(page.removals).toEqual(["a"])
  })

  it("reports expired delta links", async () => {
    const cursor = cursorOf({ inbox: delta("inbox") }, FOLDER_NAMES)
    stubRoutes([[/\/delta/, 410, {}]])
    await expect(syncOutlookPage("t", { cursor, since })).rejects.toBeInstanceOf(SyncCursorExpiredError)
    stubRoutes([[/\/delta/, 400, { error: { code: "SyncStateNotFound" } }]])
    await expect(syncOutlookPage("t", { cursor, since })).rejects.toBeInstanceOf(SyncCursorExpiredError)
  })

  it("starts over from a cursor from before folders, and never sends the token outside Graph", async () => {
    const requests = stubRoutes([])
    await expect(syncOutlookPage("t", { cursor: delta("inbox"), since })).rejects.toBeInstanceOf(SyncCursorExpiredError)
    await expect(
      syncOutlookPage("t", { cursor: cursorOf({ inbox: "https://evil.example/steal" }, FOLDER_NAMES), since })
    ).rejects.toBeInstanceOf(SyncCursorExpiredError)
    expect(requests).toEqual([])
  })
})

const encoded = (value: string) => Buffer.from(value, "utf8").toString("base64url")

describe("gmail thread reading", () => {
  const message = (id: string, date: string, labelIds = ["INBOX"]) => ({
    id,
    labelIds,
    internalDate: date,
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "Subject", value: "Plan" },
        { name: "From", value: "Jo <jo@example.com>" },
        { name: "To", value: '"Doe, Al" <al@example.com>, bo@example.com' },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: encoded("plain é") } },
            { mimeType: "text/html", body: { data: encoded("<p>html é</p>") } },
          ],
        },
        { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "x", size: 2048 } },
        {
          mimeType: "image/png",
          filename: "logo.png",
          headers: [{ name: "Content-ID", value: "<logo>" }, { name: "Content-Disposition", value: "inline" }],
          body: { attachmentId: "y", size: 10 },
        },
      ],
    },
  })

  it("orders messages, decodes bodies, and hides drafts and trash", async () => {
    stubRoutes([
      [
        /\/threads\/T\?format=full/,
        200,
        {
          messages: [
            message("later", "2000"),
            message("first", "1000"),
            message("draft", "3000", ["DRAFT"]),
            message("trashed", "4000", ["TRASH"]),
          ],
        },
      ],
    ])
    const messages = await readGmailThread("t", "T")
    expect(messages.map((item) => item.id)).toEqual(["first", "later"])
    expect(messages[0]).toMatchObject({
      subject: "Plan",
      from: { name: "Jo", email: "jo@example.com" },
      replyTo: [],
      to: [{ name: "Doe, Al", email: "al@example.com" }, { name: null, email: "bo@example.com" }],
      html: "<p>html é</p>",
      text: "plain é",
    })
    expect(messages[0]?.attachments).toEqual([{ id: "x", name: "a.pdf", size: 2048, contentType: "application/pdf" }])
    expect(messages[0]?.inline).toEqual([{ id: "y", contentId: "logo", size: 10, contentType: "image/png" }])
  })

  it("reports a thread with nothing visible as missing", async () => {
    stubRoutes([[/\/threads\//, 200, { messages: [message("draft", "1", ["DRAFT"])] }]])
    await expect(readGmailThread("t", "T")).rejects.toMatchObject({ status: 404 })
  })
})

describe("outlook thread reading", () => {
  const entry = (id: string, at: string, extra: object = {}) => ({
    id,
    subject: "Plan",
    from: { emailAddress: { name: "Jo", address: "jo@example.com" } },
    toRecipients: [{ emailAddress: { name: "", address: "al@example.com" } }],
    ccRecipients: [],
    receivedDateTime: at,
    body: { contentType: "html", content: "<p>hi</p>" },
    isDraft: false,
    parentFolderId: "inbox",
    attachments: [
      { id: "f", name: "a.pdf", size: 5, contentType: "application/pdf", isInline: false },
      { id: "l", name: "logo.png", size: 1, contentType: "image/png", isInline: true, contentId: "<logo>" },
    ],
    ...extra,
  })
  const folders: Route[] = [
    [/mailFolders\/deleteditems/, 200, { id: "trash" }],
    [/mailFolders\/junkemail/, 200, { id: "junk" }],
  ]

  it("escapes the conversation id, sorts, and hides drafts, trash and junk", async () => {
    const requests = stubRoutes([
      ...folders,
      [
        /\/me\/messages\?/,
        200,
        {
          value: [
            entry("later", "2026-10-02T10:00:00Z"),
            entry("first", "2026-10-01T10:00:00Z"),
            entry("draft", "2026-10-03T10:00:00Z", { isDraft: true }),
            entry("deleted", "2026-10-04T10:00:00Z", { parentFolderId: "trash" }),
            entry("spam", "2026-10-05T10:00:00Z", { parentFolderId: "junk" }),
          ],
        },
      ],
    ])
    const messages = await readOutlookThread("t", "AB'C=")
    const list = requests.find((request) => request.url.includes("/me/messages?"))
    expect(decodeURIComponent(list?.url ?? "")).toContain("conversationId eq 'AB''C='")
    expect(list?.headers.Prefer).toContain("ImmutableId")
    expect(messages.map((item) => item.id)).toEqual(["first", "later"])
    expect(messages[0]).toMatchObject({ html: "<p>hi</p>", text: null, to: [{ name: null, email: "al@example.com" }] })
    expect(messages[0]?.attachments.map((item) => item.name)).toEqual(["a.pdf"])
    expect(messages[0]?.inline).toEqual([{ id: "l", contentId: "logo", size: 1, contentType: "image/png" }])
  })

  it("keeps plain text out of the html field", async () => {
    stubRoutes([
      ...folders,
      [/\/me\/messages\?/, 200, { value: [entry("a", "2026-10-01T10:00:00Z", { body: { contentType: "text", content: "<b>raw</b>" } })] }],
    ])
    expect((await readOutlookThread("t", "T"))[0]).toMatchObject({ html: null, text: "<b>raw</b>" })
  })

  it("will not send the token to a next link outside Graph", async () => {
    const requests = stubRoutes([
      ...folders,
      [/\/me\/messages\?/, 200, { value: [], "@odata.nextLink": "https://evil.example/x" }],
    ])
    await expect(readOutlookThread("t", "T")).rejects.toBeInstanceOf(ProviderError)
    expect(requests.some((request) => request.url.includes("evil.example"))).toBe(false)
  })
})
