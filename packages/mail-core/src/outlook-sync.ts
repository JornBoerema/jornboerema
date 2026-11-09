import { cleanText, getJson, mapInChunks } from "./http"
import {
  ProviderError,
  SyncCursorExpiredError,
  type MailMessageData,
  type SyncPage,
} from "./provider"

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

const SELECT =
  "id,conversationId,subject,bodyPreview,from,receivedDateTime,isRead,flag,hasAttachments"
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

function toData(message: GraphMessage): MailMessageData {
  return {
    providerMessageId: message.id,
    threadId: message.conversationId ?? null,
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

function firstDeltaUrl(since: Date) {
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)
  const order = encodeURIComponent("receivedDateTime desc")
  return `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?$select=${SELECT}&$filter=${filter}&$orderby=${order}`
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
  // A stored link receives the bearer token, so it may only ever point at Graph.
  if (cursor && !cursor.startsWith(`${GRAPH_BASE}/`))
    throw new SyncCursorExpiredError("Unexpected Graph cursor")

  let delta: DeltaResponse
  try {
    delta = await getJson(cursor ?? firstDeltaUrl(since), accessToken, {
      Prefer: `odata.maxpagesize=100, ${ID_HEADER}`,
    })
  } catch (error) {
    if (error instanceof ProviderError && isExpired(error))
      throw new SyncCursorExpiredError("Graph delta link is gone")
    throw error
  }

  const nextCursor = delta["@odata.nextLink"] ?? delta["@odata.deltaLink"]
  if (!nextCursor) throw new ProviderError("Graph delta response has no next link")

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

  const upserts = complete.map(toData)
  for (const { id, message } of read) {
    if (message?.receivedDateTime) upserts.push(toData(message))
    else removals.push(id)
  }
  return { upserts, removals, cursor: nextCursor, done: !delta["@odata.nextLink"] }
}
