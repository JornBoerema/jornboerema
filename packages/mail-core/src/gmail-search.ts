import { headerOf, type GmailFullMessage } from "./gmail-read"
import { decodeEntities, GMAIL_API, parseAddress } from "./gmail-sync"
import { cleanText, getJson, mapInChunks } from "./http"
import { ProviderError } from "./provider"
import { MAX_SEARCH_HITS, type MailSearchHit } from "./types"

// A thread read costs 10 of the 250 quota units a user gets per second.
const READ_CONCURRENCY = 3

type Thread = { id: string; messages?: (GmailFullMessage & { snippet?: string })[] }

/** Gmail's own search, so its operators (from:, has:attachment, older_than:) work too. */
export async function searchGmail(accessToken: string, query: string): Promise<Omit<MailSearchHit, "accountId">[]> {
  const params = new URLSearchParams({ q: `${query} -in:draft`, maxResults: String(MAX_SEARCH_HITS) })
  const list = await getJson<{ threads?: { id: string }[] }>(`${GMAIL_API}/threads?${params}`, accessToken)
  const metadata = "format=metadata&metadataHeaders=From&metadataHeaders=Subject"
  const threads = await mapInChunks(list.threads ?? [], READ_CONCURRENCY, async ({ id }) => {
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
    return [
      {
        threadId: thread.id,
        subject: cleanText(headerOf(messages[0]?.payload?.headers, "subject") ?? ""),
        snippet: cleanText(decodeEntities(newest.snippet ?? "")),
        fromName: from.name && cleanText(from.name),
        fromEmail: from.email && cleanText(from.email),
        receivedAt: new Date(Number(newest.internalDate ?? 0)).toISOString(),
        isRead: !messages.some((message) => message.labelIds?.includes("UNREAD")),
        hasAttachments: messages.some((message) => message.payload?.mimeType === "multipart/mixed"),
      },
    ]
  })
}
