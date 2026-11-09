import { cleanText, getJson, mapInChunks } from "./http"
import {
  ProviderError,
  SyncCursorExpiredError,
  type MailMessageData,
  type SyncPage,
} from "./provider"

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
const PAGE_SIZE = 100
// Each read costs 5 of the 250 quota units a user gets per second, and answers can
// take well under 100ms, so more parallel reads than this can exceed the limit.
const READ_CONCURRENCY = 2

type GmailCursor = { historyId: string; pageToken?: string; backfill: boolean }

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
    if (typeof parsed.historyId === "string") return parsed
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

function toData(message: GmailMessage): MailMessageData {
  const header = (name: string) =>
    message.payload?.headers?.find((item) => item.name?.toLowerCase() === name)?.value
  const from = parseAddress(header("from"))
  const labels = message.labelIds ?? []
  return {
    providerMessageId: message.id,
    threadId: message.threadId ?? null,
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
  const params = "format=metadata&metadataHeaders=From&metadataHeaders=Subject"
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

async function backfillPage(
  accessToken: string,
  state: GmailCursor,
  since: Date
): Promise<SyncPage> {
  const params = new URLSearchParams({
    labelIds: "INBOX",
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
  const inInbox = read.filter((item) => item?.labelIds?.includes("INBOX")) as GmailMessage[]
  const next: GmailCursor = list.nextPageToken
    ? { historyId: state.historyId, pageToken: list.nextPageToken, backfill: true }
    : { historyId: state.historyId, backfill: false }
  // Not done after the last page: changes made during the backfill are still in history.
  return { upserts: inInbox.map(toData), removals: [], cursor: JSON.stringify(next), done: false }
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

  // History says something changed; the current labels say what the inbox should show.
  const upserts: MailMessageData[] = []
  const removals = [...deleted]
  for (const { id, message } of read) {
    if (message?.labelIds?.includes("INBOX")) upserts.push(toData(message))
    else removals.push(id)
  }

  const next: GmailCursor = history.nextPageToken
    ? { historyId: state.historyId, pageToken: history.nextPageToken, backfill: false }
    : { historyId: history.historyId ?? state.historyId, backfill: false }
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
  return backfillPage(accessToken, { historyId: profile.historyId, backfill: true }, since)
}
