import { afterEach, describe, expect, it, vi } from "vitest"
import { readGmailThread } from "../src/gmail-read"
import { syncGmailPage } from "../src/gmail-sync"
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
        { name: "Subject", value: "Hi\u0000 there" },
      ],
    },
  }
}

describe("gmail sync", () => {
  it("takes the history id before listing and maps metadata", async () => {
    const requests = stubRoutes([
      [/\/profile$/, 200, { historyId: "50" }],
      [/\/messages\?/, 200, { messages: [{ id: "a" }], nextPageToken: "next" }],
      [/\/messages\/a\?/, 200, gmailMessage("a")],
    ])
    const page = await syncGmailPage("t", { cursor: null, since })

    expect(requests[0]?.url).toMatch(/\/profile$/)
    expect(new URL(requests[1]?.url ?? "").searchParams.get("q")).toBe(`after:${since.getTime() / 1000}`)
    expect(page.done).toBe(false)
    expect(JSON.parse(page.cursor)).toEqual({ historyId: "50", pageToken: "next", backfill: true })
    expect(page.upserts[0]).toMatchObject({
      providerMessageId: "a",
      threadId: "t-a",
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
    const cursor = JSON.stringify({ historyId: "50", pageToken: "p", backfill: true })
    const page = await syncGmailPage("t", { cursor, since })
    expect(page.done).toBe(false)
    expect(JSON.parse(page.cursor)).toEqual({ historyId: "50", backfill: false })
  })

  it("derives upserts and removals from history and current labels", async () => {
    stubRoutes([
      [
        /\/history\?/,
        200,
        {
          historyId: "60",
          history: [
            {
              messagesAdded: [{ message: { id: "new" } }],
              labelsRemoved: [{ message: { id: "archived" } }],
              labelsAdded: [{ message: { id: "gone" } }, { message: { id: "deleted" } }],
              messagesDeleted: [{ message: { id: "deleted" } }],
            },
          ],
        },
      ],
      [/\/messages\/new\?/, 200, gmailMessage("new")],
      [/\/messages\/archived\?/, 200, gmailMessage("archived", ["CATEGORY_UPDATES"])],
      [/\/messages\/gone\?/, 404, {}],
    ])
    const page = await syncGmailPage("t", {
      cursor: JSON.stringify({ historyId: "50", backfill: false }),
      since,
    })
    expect(page.done).toBe(true)
    expect(page.upserts.map((item) => item.providerMessageId)).toEqual(["new"])
    expect(page.removals.sort()).toEqual(["archived", "deleted", "gone"])
    expect(JSON.parse(page.cursor).historyId).toBe("60")
  })

  it("reports expired history and unreadable cursors", async () => {
    stubRoutes([[/\/history\?/, 404, {}]])
    const cursor = JSON.stringify({ historyId: "1", backfill: false })
    await expect(syncGmailPage("t", { cursor, since })).rejects.toBeInstanceOf(SyncCursorExpiredError)
    await expect(syncGmailPage("t", { cursor: "nonsense", since })).rejects.toBeInstanceOf(
      SyncCursorExpiredError
    )
  })

  it("recognizes throttling from the reason Google sends", async () => {
    const cursor = JSON.stringify({ historyId: "1", backfill: false })
    stubRoutes([[/\/history\?/, 403, { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } }]])
    expect(isRateLimited(await syncGmailPage("t", { cursor, since }).catch((e: unknown) => e))).toBe(true)
    stubRoutes([[/\/history\?/, 403, { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } }]])
    expect(isRateLimited(await syncGmailPage("t", { cursor, since }).catch((e: unknown) => e))).toBe(false)
  })

  it("does not treat other failures as an expired cursor", async () => {
    stubRoutes([[/\/history\?/, 503, {}]])
    const cursor = JSON.stringify({ historyId: "1", backfill: false })
    await expect(syncGmailPage("t", { cursor, since })).rejects.toBeInstanceOf(ProviderError)
  })
})

const graphMessage = (id: string) => ({
  id,
  conversationId: `c-${id}`,
  subject: "Hello",
  bodyPreview: "Preview",
  from: { emailAddress: { name: "Jo", address: "jo@example.com" } },
  receivedDateTime: "2026-10-01T10:00:00Z",
  isRead: true,
  flag: { flagStatus: "flagged" },
  hasAttachments: false,
})

const NEXT = `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?$skiptoken=x`
const DELTA = `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?$deltatoken=y`

describe("outlook sync", () => {
  it("starts from the window with immutable ids and keeps paging", async () => {
    const requests = stubRoutes([
      [/\/delta/, 200, { value: [graphMessage("a")], "@odata.nextLink": NEXT }],
    ])
    const page = await syncOutlookPage("t", { cursor: null, since })

    const first = decodeURIComponent(requests[0]?.url ?? "")
    expect(first).toContain(`receivedDateTime ge ${since.toISOString()}`)
    expect(first).toContain("receivedDateTime desc")
    expect(requests[0]?.headers.Prefer).toContain('IdType="ImmutableId"')
    expect(page).toMatchObject({ cursor: NEXT, done: false, removals: [] })
    expect(page.upserts[0]).toMatchObject({ threadId: "c-a", isRead: true, isStarred: true })
  })

  it("finishes on a delta link, handles removals and completes partial updates", async () => {
    const requests = stubRoutes([
      [
        /\/delta/,
        200,
        {
          "@odata.deltaLink": DELTA,
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
    const page = await syncOutlookPage("t", { cursor: NEXT, since })

    expect(requests[0]?.url).toBe(NEXT)
    expect(page).toMatchObject({ cursor: DELTA, done: true })
    expect(page.upserts.map((item) => item.providerMessageId)).toEqual(["partial"])
    expect(page.removals.sort()).toEqual(["removed", "vanished"])
  })

  it("keeps only the last state when an id appears twice", async () => {
    stubRoutes([
      [
        /\/delta/,
        200,
        {
          "@odata.deltaLink": DELTA,
          value: [graphMessage("a"), { id: "a", "@removed": { reason: "deleted" } }],
        },
      ],
    ])
    const page = await syncOutlookPage("t", { cursor: NEXT, since })
    expect(page.upserts).toEqual([])
    expect(page.removals).toEqual(["a"])
  })

  it("reports expired delta links", async () => {
    stubRoutes([[/\/delta/, 410, {}]])
    await expect(syncOutlookPage("t", { cursor: DELTA, since })).rejects.toBeInstanceOf(
      SyncCursorExpiredError
    )
    stubRoutes([[/\/delta/, 400, { error: { code: "SyncStateNotFound" } }]])
    await expect(syncOutlookPage("t", { cursor: DELTA, since })).rejects.toBeInstanceOf(
      SyncCursorExpiredError
    )
  })

  it("never sends the token to a cursor outside Graph", async () => {
    const requests = stubRoutes([])
    await expect(
      syncOutlookPage("t", { cursor: "https://evil.example/steal", since })
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
