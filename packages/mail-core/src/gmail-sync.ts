import { cleanText, getJson, mapInChunks } from "./http"
import {
  ProviderError,
  SyncCursorExpiredError,
  type MailMessageData,
  type MailMessageFolder,
  type SyncPage,
} from "./provider"

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
const PAGE_SIZE = 100
// Each read costs 5 of the 250 quota units a user gets per second. Four at a time
// stays near half of that, since an answer takes 100 to 200ms.
const READ_CONCURRENCY = 4
/** Cursors from before every folder was synced lack this, which starts a full sync. */
const CURSOR_VERSION = 2

type GmailCursor = { v: number; historyId: string; pageToken?: string; backfill: boolean }

type GmailMessage = {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: { mimeType?: string; headers?: { name?: string; value?: string }[] }
}

type HistoryRecord = {
  messagesAdded?: { message: { id: string } }[]
  messagesDeleted?: { message: { id: string } }[]
  labelsAdded?: { message: { id: string } }[]
  labelsRemoved?: { message: { id: string } }[]
}

function parseCursor(cursor: string): GmailCursor {
  try {
    const parsed = JSON.parse(cursor) as GmailCursor
    if (typeof parsed.historyId === "string" && parsed.v === CURSOR_VERSION) return parsed
  } catch {
    // Handled below: an unreadable position means starting over.
  }
  throw new SyncCursorExpiredError("Unreadable Gmail cursor")
}

/** Gmail escapes HTML in snippets even though they are plain text. */
export function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (match, dec, hex, name) => {
    if (name) return named[name.toLowerCase()] ?? match
    const code = dec ? Number(dec) : Number.parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

export function parseAddress(value: string | undefined) {
  if (!value) return { name: null, email: null }
  const match = value.match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/)
  return match
    ? { name: match[1] || null, email: match[2] }
    : { name: null, email: value.trim() || null }
}

/**
 * Gmail labels as one folder. Trash and spam win; a message that is both in the
 * inbox and sent (mail to yourself) is inbox. Without either it was archived.
 * Drafts and chats aren't mail to list, so they have none.
 */
export function folderOf(labels: string[]): MailMessageFolder | null {
  if (labels.includes("DRAFT") || labels.includes("CHAT")) return null
  if (labels.includes("TRASH")) return "trash"
  if (labels.includes("SPAM")) return "spam"
  if (labels.includes("INBOX")) return "inbox"
  if (labels.includes("SENT")) return "sent"
  return "archive"
}

/** Splits on the commas between addresses, not those inside "Last, First". */
function splitAddresses(value: string) {
  const items: string[] = []
  let current = ""
  let quoted = false
  for (const char of value) {
    if (char === '"') quoted = !quoted
    if (char === "," && !quoted) {
      items.push(current)
      current = ""
    } else current += char
  }
  items.push(current)
  return items
}

/** At most this many recipients are kept: enough to name who a sent mail went to. */
const MAX_RECIPIENTS = 20

function toData(message: GmailMessage, folder: MailMessageFolder): MailMessageData {
  const header = (name: string) =>
    message.payload?.headers?.find((item) => item.name?.toLowerCase() === name)?.value
  const from = parseAddress(header("from"))
  const labels = message.labelIds ?? []
  const to = splitAddresses(header("to") ?? "")
    .map((item) => parseAddress(item))
    .flatMap(({ name, email }) => (email ? [{ name: name && cleanText(name), email: cleanText(email) }] : []))
    .slice(0, MAX_RECIPIENTS)
  return {
    providerMessageId: message.id,
    threadId: message.threadId ?? null,
    folder,
    to,
    subject: cleanText(header("subject") ?? ""),
    snippet: cleanText(decodeEntities(message.snippet ?? "")),
    fromName: from.name && cleanText(from.name),
    fromEmail: from.email && cleanText(from.email),
    receivedAt: new Date(Number(message.internalDate ?? 0)),
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    // Metadata responses omit the parts; mixed is how attachments are packaged.
    hasAttachments: message.payload?.mimeType === "multipart/mixed",
  }
}

/** Reads one message. Null means it no longer exists. */
async function readMessage(accessToken: string, id: string) {
  const params = "format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=To"
  try {
    return await getJson<GmailMessage>(
      `${GMAIL_API}/messages/${encodeURIComponent(id)}?${params}`,
      accessToken
    )
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) return null
    throw error
  }
}

/** Messages as rows, leaving out what has no folder (drafts, chats). */
function described(messages: (GmailMessage | null)[]) {
  return messages.flatMap((message) => {
    const folder = message && folderOf(message.labelIds ?? [])
    return message && folder ? [toData(message, folder)] : []
  })
}

async function backfillPage(
  accessToken: string,
  state: GmailCursor,
  since: Date
): Promise<SyncPage> {
  // Every folder, spam and trash included; drafts and chats are dropped below.
  const params = new URLSearchParams({
    includeSpamTrash: "true",
    maxResults: String(PAGE_SIZE),
    q: `after:${Math.floor(since.getTime() / 1000)}`,
  })
  if (state.pageToken) params.set("pageToken", state.pageToken)
  const list = await getJson<{ messages?: { id: string }[]; nextPageToken?: string }>(
    `${GMAIL_API}/messages?${params}`,
    accessToken
  )
  const read = await mapInChunks(list.messages ?? [], READ_CONCURRENCY, ({ id }) =>
    readMessage(accessToken, id)
  )
  const next: GmailCursor = list.nextPageToken
    ? { v: CURSOR_VERSION, historyId: state.historyId, pageToken: list.nextPageToken, backfill: true }
    : { v: CURSOR_VERSION, historyId: state.historyId, backfill: false }
  // Not done after the last page: changes made during the backfill are still in history.
  return { upserts: described(read), removals: [], cursor: JSON.stringify(next), done: false }
}

async function historyPage(accessToken: string, state: GmailCursor): Promise<SyncPage> {
  const params = new URLSearchParams({
    startHistoryId: state.historyId,
    maxResults: String(PAGE_SIZE),
  })
  if (state.pageToken) params.set("pageToken", state.pageToken)

  let history: { history?: HistoryRecord[]; nextPageToken?: string; historyId?: string }
  try {
    history = await getJson(`${GMAIL_API}/history?${params}`, accessToken)
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404)
      throw new SyncCursorExpiredError("Gmail history is gone")
    throw error
  }

  const deleted = new Set<string>()
  const touched = new Set<string>()
  for (const record of history.history ?? []) {
    for (const { message } of record.messagesDeleted ?? []) deleted.add(message.id)
    for (const { message } of [
      ...(record.messagesAdded ?? []),
      ...(record.labelsAdded ?? []),
      ...(record.labelsRemoved ?? []),
    ])
      touched.add(message.id)
  }
  const ids = [...touched].filter((id) => !deleted.has(id))
  const read = await mapInChunks(ids, READ_CONCURRENCY, async (id) => ({
    id,
    message: await readMessage(accessToken, id),
  }))

  // History says something changed; the current labels say where the message now is.
  const upserts: MailMessageData[] = []
  const removals = [...deleted]
  for (const { id, message } of read) {
    const folder = message && folderOf(message.labelIds ?? [])
    if (message && folder) upserts.push(toData(message, folder))
    else removals.push(id)
  }

  const next: GmailCursor = history.nextPageToken
    ? { v: CURSOR_VERSION, historyId: state.historyId, pageToken: history.nextPageToken, backfill: false }
    : { v: CURSOR_VERSION, historyId: history.historyId ?? state.historyId, backfill: false }
  return { upserts, removals, cursor: JSON.stringify(next), done: !history.nextPageToken }
}

export async function syncGmailPage(
  accessToken: string,
  { cursor, since }: { cursor: string | null; since: Date }
): Promise<SyncPage> {
  if (cursor) {
    const state = parseCursor(cursor)
    return state.backfill
      ? backfillPage(accessToken, state, since)
      : historyPage(accessToken, state)
  }
  // Taken before listing, so anything that changes during the backfill is replayed after it.
  const profile = await getJson<{ historyId?: string }>(`${GMAIL_API}/profile`, accessToken)
  if (!profile.historyId) throw new ProviderError("Gmail profile has no history id")
  return backfillPage(accessToken, { v: CURSOR_VERSION, historyId: profile.historyId, backfill: true }, since)
}
