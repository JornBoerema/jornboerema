import { cleanText, getJson } from "./http"
import { GRAPH_BASE } from "./outlook-sync"
import { ProviderError } from "./provider"
import { FOLDER_PAGE_SIZE, MAX_SEARCH_HITS, type MailFolder, type MailSearchHit } from "./types"

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

const FOLDER_SELECT = `${SELECT},toRecipients,flag`
/** Graph's well-known folder names. Starred is a flag, so it is a query over all mail. */
const WELL_KNOWN: Record<Exclude<MailFolder, "starred">, string> = {
  sent: "sentitems",
  archive: "archive",
  spam: "junkemail",
  trash: "deleteditems",
}

type FolderMessage = Found & {
  toRecipients?: { emailAddress?: { name?: string | null; address?: string | null } }[]
  flag?: { flagStatus?: string }
}

export async function listOutlookFolder(
  accessToken: string,
  { folder, pageToken }: { folder: MailFolder; pageToken: string | null }
) {
  const first =
    folder === "starred"
      ? // Graph only sorts on a property that the filter also names, first.
        `${GRAPH_BASE}/me/messages?$filter=${encodeURIComponent("receivedDateTime ge 1900-01-01T00:00:00Z and flag/flagStatus eq 'flagged'")}`
      : `${GRAPH_BASE}/me/mailFolders/${WELL_KNOWN[folder]}/messages?$filter=${encodeURIComponent("receivedDateTime ge 1900-01-01T00:00:00Z")}`
  const url = pageToken ?? `${first}&$orderby=receivedDateTime%20desc&$top=${FOLDER_PAGE_SIZE}&$select=${FOLDER_SELECT}`
  if (!url.startsWith(`${GRAPH_BASE}/`)) throw new ProviderError("Unexpected Graph next link")
  let page: { value?: FolderMessage[]; "@odata.nextLink"?: string }
  try {
    page = await getJson(url, accessToken, ID_HEADER)
  } catch (error) {
    // Not every mailbox has an archive folder.
    if (error instanceof ProviderError && error.status === 404) return { hits: [], nextPageToken: null }
    throw error
  }
  const seen = new Set<string>()
  const hits: Omit<MailSearchHit, "accountId">[] = []
  for (const message of page.value ?? []) {
    const threadId = message.conversationId
    if (!threadId || message.isDraft || seen.has(threadId)) continue
    seen.add(threadId)
    hits.push({
      threadId,
      subject: cleanText(message.subject ?? ""),
      snippet: cleanText(message.bodyPreview ?? ""),
      fromName: message.from?.emailAddress?.name ? cleanText(message.from.emailAddress.name) : null,
      fromEmail: message.from?.emailAddress?.address ? cleanText(message.from.emailAddress.address) : null,
      to: (message.toRecipients ?? []).flatMap((recipient) =>
        recipient.emailAddress?.address
          ? [{ name: recipient.emailAddress.name || null, email: recipient.emailAddress.address }]
          : []
      ),
      receivedAt: new Date(message.receivedDateTime ?? 0).toISOString(),
      isRead: message.isRead ?? true,
      isStarred: message.flag?.flagStatus === "flagged",
      hasAttachments: Boolean(message.hasAttachments),
    })
  }
  return { hits, nextPageToken: page["@odata.nextLink"] ?? null }
}
