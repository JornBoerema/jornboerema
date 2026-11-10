import { headerOf, toAddresses, type GmailFullMessage } from "./gmail-read"
import { decodeEntities, GMAIL_API, parseAddress } from "./gmail-sync"
import { cleanText, getJson, mapInChunks } from "./http"
import { ProviderError } from "./provider"
import { FOLDER_PAGE_SIZE, MAX_SEARCH_HITS, type MailFolder, type MailSearchHit } from "./types"

// A thread read costs 10 of the 250 quota units a user gets per second.
const READ_CONCURRENCY = 3

type Thread = { id: string; messages?: (GmailFullMessage & { snippet?: string })[] }
type ThreadList = { threads?: { id: string }[]; nextPageToken?: string }

/** One line per conversation, described by its newest message. Drafts don't count. */
async function describeThreads(accessToken: string, ids: string[]): Promise<Omit<MailSearchHit, "accountId">[]> {
  const metadata = "format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=To"
  const threads = await mapInChunks(ids, READ_CONCURRENCY, async (id) => {
    try {
      return await getJson<Thread>(`${GMAIL_API}/threads/${encodeURIComponent(id)}?${metadata}`, accessToken)
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return null
      throw error
    }
  })
  return threads.flatMap((thread) => {
    const messages = (thread?.messages ?? []).filter((message) => !message.labelIds?.includes("DRAFT"))
    const newest = messages.at(-1)
    if (!thread || !newest) return []
    const headers = newest.payload?.headers
    const from = parseAddress(headerOf(headers, "from"))
    const labels = (label: string) => messages.some((message) => message.labelIds?.includes(label))
    return [
      {
        threadId: thread.id,
        subject: cleanText(headerOf(messages[0]?.payload?.headers, "subject") ?? ""),
        snippet: cleanText(decodeEntities(newest.snippet ?? "")),
        fromName: from.name && cleanText(from.name),
        fromEmail: from.email && cleanText(from.email),
        to: toAddresses(headerOf(headers, "to")),
        receivedAt: new Date(Number(newest.internalDate ?? 0)).toISOString(),
        isRead: !labels("UNREAD"),
        isStarred: labels("STARRED"),
        hasAttachments: messages.some((message) => message.payload?.mimeType === "multipart/mixed"),
      },
    ]
  })
}

/** Gmail's own search, so its operators (from:, has:attachment, older_than:) work too. */
export async function searchGmail(accessToken: string, query: string): Promise<Omit<MailSearchHit, "accountId">[]> {
  const params = new URLSearchParams({ q: `${query} -in:draft`, maxResults: String(MAX_SEARCH_HITS) })
  const list = await getJson<ThreadList>(`${GMAIL_API}/threads?${params}`, accessToken)
  return describeThreads(accessToken, (list.threads ?? []).map((thread) => thread.id))
}

/** Gmail has labels, not folders. Archived mail is whatever left the inbox without a place to go. */
const FOLDER_QUERY: Record<MailFolder, Record<string, string>> = {
  starred: { labelIds: "STARRED" },
  sent: { labelIds: "SENT" },
  archive: { q: "-in:inbox -in:sent -in:draft -in:spam -in:trash -in:chats" },
  spam: { labelIds: "SPAM", includeSpamTrash: "true" },
  trash: { labelIds: "TRASH", includeSpamTrash: "true" },
}

export async function listGmailFolder(
  accessToken: string,
  { folder, pageToken }: { folder: MailFolder; pageToken: string | null }
) {
  const params = new URLSearchParams({ ...FOLDER_QUERY[folder], maxResults: String(FOLDER_PAGE_SIZE) })
  if (pageToken) params.set("pageToken", pageToken)
  const list = await getJson<ThreadList>(`${GMAIL_API}/threads?${params}`, accessToken)
  return {
    hits: await describeThreads(accessToken, (list.threads ?? []).map((thread) => thread.id)),
    nextPageToken: list.nextPageToken ?? null,
  }
}
