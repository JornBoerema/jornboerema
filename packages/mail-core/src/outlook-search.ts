import { cleanText, getJson } from "./http"
import { GRAPH_BASE } from "./outlook-sync"
import { MAX_SEARCH_HITS, type MailSearchHit } from "./types"

const ID_HEADER = { Prefer: 'IdType="ImmutableId"' }
const SELECT = "id,conversationId,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments,isDraft,parentFolderId"

type Found = {
  conversationId?: string
  subject?: string | null
  bodyPreview?: string | null
  from?: { emailAddress?: { name?: string | null; address?: string | null } } | null
  receivedDateTime?: string
  isRead?: boolean
  hasAttachments?: boolean
  isDraft?: boolean
  parentFolderId?: string
}

/** Graph's keyword search over the whole mailbox, one line per conversation. */
export async function searchOutlook(accessToken: string, query: string): Promise<Omit<MailSearchHit, "accountId">[]> {
  // The value sits inside double quotes; Graph has no way to escape one there.
  const terms = query.replace(/["\\]/g, " ").trim()
  if (!terms) return []
  const [found, hidden] = await Promise.all([
    getJson<{ value?: Found[] }>(
      `${GRAPH_BASE}/me/messages?$search=${encodeURIComponent(`"${terms}"`)}&$top=50&$select=${SELECT}`,
      accessToken,
      ID_HEADER
    ),
    Promise.all(
      ["deleteditems", "junkemail"].map((name) =>
        getJson<{ id: string }>(`${GRAPH_BASE}/me/mailFolders/${name}?$select=id`, accessToken, ID_HEADER)
      )
    ),
  ])
  const hiddenFolders = new Set(hidden.map((folder) => folder.id))
  const seen = new Set<string>()
  const hits: Omit<MailSearchHit, "accountId">[] = []
  for (const message of found.value ?? []) {
    const threadId = message.conversationId
    if (!threadId || message.isDraft || hiddenFolders.has(message.parentFolderId ?? "") || seen.has(threadId)) continue
    seen.add(threadId)
    hits.push({
      threadId,
      subject: cleanText(message.subject ?? ""),
      snippet: cleanText(message.bodyPreview ?? ""),
      fromName: message.from?.emailAddress?.name ? cleanText(message.from.emailAddress.name) : null,
      fromEmail: message.from?.emailAddress?.address ? cleanText(message.from.emailAddress.address) : null,
      receivedAt: new Date(message.receivedDateTime ?? 0).toISOString(),
      isRead: message.isRead ?? true,
      hasAttachments: Boolean(message.hasAttachments),
    })
    if (hits.length >= MAX_SEARCH_HITS) break
  }
  return hits
}
