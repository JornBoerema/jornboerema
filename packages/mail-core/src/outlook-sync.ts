import { cleanText, getJson, mapInChunks } from "./http"
import {
  ProviderError,
  SyncCursorExpiredError,
  type MailMessageData,
  type MailMessageFolder,
  type SyncPage,
} from "./provider"

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

const SELECT =
  "id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,flag,hasAttachments"
/** Graph's well-known folders, synced one after the other. Custom folders aren't synced. */
const FOLDERS: [string, MailMessageFolder][] = [
  ["inbox", "inbox"],
  ["sentitems", "sent"],
  ["archive", "archive"],
  ["junkemail", "spam"],
  ["deleteditems", "trash"],
]
/** At most this many recipients are kept: enough to name who a sent mail went to. */
const MAX_RECIPIENTS = 20

/**
 * Where each folder's delta stands, and which folders this round still has to
 * catch up. A round is done once every folder reached its delta link.
 */
type OutlookCursor = { v: 2; links: Record<string, string>; pending: string[] }
const READ_CONCURRENCY = 5
// Immutable ids survive moves between folders, which later phases rely on.
const ID_HEADER = 'IdType="ImmutableId"'

type GraphMessage = {
  id: string
  "@removed"?: unknown
  conversationId?: string
  subject?: string | null
  bodyPreview?: string | null
  from?: { emailAddress?: { name?: string | null; address?: string | null } } | null
  toRecipients?: { emailAddress?: { name?: string | null; address?: string | null } }[]
  receivedDateTime?: string
  isRead?: boolean
  flag?: { flagStatus?: string } | null
  hasAttachments?: boolean
}

type DeltaResponse = {
  value?: GraphMessage[]
  "@odata.nextLink"?: string
  "@odata.deltaLink"?: string
}

const optional = (value: string | null | undefined) => (value ? cleanText(value) : null)

function toData(message: GraphMessage, folder: MailMessageFolder): MailMessageData {
  return {
    providerMessageId: message.id,
    threadId: message.conversationId ?? null,
    folder,
    to: (message.toRecipients ?? [])
      .flatMap((recipient) =>
        recipient.emailAddress?.address
          ? [{ name: optional(recipient.emailAddress.name), email: cleanText(recipient.emailAddress.address) }]
          : []
      )
      .slice(0, MAX_RECIPIENTS),
    subject: cleanText(message.subject ?? ""),
    snippet: cleanText(message.bodyPreview ?? ""),
    fromName: optional(message.from?.emailAddress?.name),
    fromEmail: optional(message.from?.emailAddress?.address),
    receivedAt: new Date(message.receivedDateTime as string),
    isRead: message.isRead ?? false,
    isStarred: message.flag?.flagStatus === "flagged",
    hasAttachments: message.hasAttachments ?? false,
  }
}

function firstDeltaUrl(folder: string, since: Date) {
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)
  const order = encodeURIComponent("receivedDateTime desc")
  return `${GRAPH_BASE}/me/mailFolders/${folder}/messages/delta?$select=${SELECT}&$filter=${filter}&$orderby=${order}`
}

function parseCursor(cursor: string | null): OutlookCursor {
  if (!cursor) return { v: 2, links: {}, pending: FOLDERS.map(([name]) => name) }
  let parsed: OutlookCursor
  try {
    parsed = JSON.parse(cursor) as OutlookCursor
  } catch {
    // Cursors from before every folder was synced were bare links: start over.
    throw new SyncCursorExpiredError("Unreadable Graph cursor")
  }
  const known = new Set(FOLDERS.map(([name]) => name))
  // A stored link receives the bearer token, so it may only ever point at Graph.
  if (
    parsed.v !== 2 ||
    !Array.isArray(parsed.pending) ||
    !parsed.pending.every((name) => known.has(name)) ||
    !Object.values(parsed.links ?? {}).every((link) => typeof link === "string" && link.startsWith(`${GRAPH_BASE}/`))
  )
    throw new SyncCursorExpiredError("Unexpected Graph cursor")
  // The last round finished: the next one catches every folder up again.
  return parsed.pending.length > 0 ? parsed : { ...parsed, pending: FOLDERS.map(([name]) => name) }
}

const isExpired = (error: ProviderError) =>
  error.status === 410 || /syncstate|resync/i.test(error.code ?? "")

/** Reads a message the delta only partly described. Null means it no longer exists. */
async function readMessage(accessToken: string, id: string) {
  try {
    return await getJson<GraphMessage>(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}?$select=${SELECT}`,
      accessToken,
      { Prefer: ID_HEADER }
    )
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) return null
    throw error
  }
}

export async function syncOutlookPage(
  accessToken: string,
  { cursor, since }: { cursor: string | null; since: Date }
): Promise<SyncPage> {
  const state = parseCursor(cursor)
  const name = state.pending[0] as string
  const folder = FOLDERS.find(([known]) => known === name)?.[1] ?? "inbox"

  let delta: DeltaResponse
  try {
    delta = await getJson(state.links[name] ?? firstDeltaUrl(name, since), accessToken, {
      Prefer: `odata.maxpagesize=100, ${ID_HEADER}`,
    })
  } catch (error) {
    if (error instanceof ProviderError && isExpired(error))
      throw new SyncCursorExpiredError("Graph delta link is gone")
    // Not every mailbox has an archive folder; it counts as caught up.
    if (error instanceof ProviderError && error.status === 404 && !state.links[name]) {
      const next: OutlookCursor = { ...state, pending: state.pending.slice(1) }
      return { upserts: [], removals: [], cursor: JSON.stringify(next), done: next.pending.length === 0 }
    }
    throw error
  }

  const link = delta["@odata.nextLink"] ?? delta["@odata.deltaLink"]
  if (!link) throw new ProviderError("Graph delta response has no next link")
  if (!link.startsWith(`${GRAPH_BASE}/`)) throw new ProviderError("Unexpected Graph next link")
  const next: OutlookCursor = {
    v: 2,
    links: { ...state.links, [name]: link },
    // This folder is caught up once Graph hands back its delta link.
    pending: delta["@odata.nextLink"] ? state.pending : state.pending.slice(1),
  }

  // A later entry for the same id replaces an earlier one, so the last state wins.
  const latest = new Map((delta.value ?? []).map((entry) => [entry.id, entry]))
  const entries = [...latest.values()]
  const removals = entries.filter((entry) => entry["@removed"]).map((entry) => entry.id)
  const live = entries.filter((entry) => !entry["@removed"])
  const complete = live.filter((entry) => entry.receivedDateTime)
  // Updates may carry only the changed fields; those need a full read.
  const partial = live.filter((entry) => !entry.receivedDateTime)
  const read = await mapInChunks(partial, READ_CONCURRENCY, async ({ id }) => ({
    id,
    message: await readMessage(accessToken, id),
  }))

  const upserts = complete.map((message) => toData(message, folder))
  for (const { id, message } of read) {
    if (message?.receivedDateTime) upserts.push(toData(message, folder))
    else removals.push(id)
  }
  // Removed from this folder's delta can mean moved to another folder, which then keeps it.
  return {
    upserts,
    removals,
    removalFolder: folder,
    cursor: JSON.stringify(next),
    done: next.pending.length === 0,
  }
}
