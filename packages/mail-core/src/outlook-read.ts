import { getJson } from "./http"
import { GRAPH_BASE } from "./outlook-sync"
import { ProviderError } from "./provider"
import type { MailAddress, MailThreadMessage } from "./types"

const SELECT =
  "id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,isDraft,parentFolderId"
const EXPAND = "attachments($select=name,size,contentType,isInline)"
const ID_HEADER = { Prefer: 'IdType="ImmutableId"' }
/** A conversation longer than this is cut off rather than risking the function limit. */
const MAX_PAGES = 4

type Recipient = { emailAddress?: { name?: string | null; address?: string | null } }

type GraphMessage = {
  id: string
  subject?: string | null
  from?: Recipient | null
  toRecipients?: Recipient[]
  ccRecipients?: Recipient[]
  receivedDateTime?: string
  body?: { contentType?: string; content?: string } | null
  isDraft?: boolean
  parentFolderId?: string
  attachments?: { name?: string; size?: number; contentType?: string; isInline?: boolean }[]
}

type MessagesResponse = { value?: GraphMessage[]; "@odata.nextLink"?: string }

function toAddress(recipient: Recipient | null | undefined): MailAddress | null {
  const email = recipient?.emailAddress?.address
  return email ? { name: recipient?.emailAddress?.name || null, email } : null
}

const toAddresses = (recipients: Recipient[] | undefined) =>
  (recipients ?? []).flatMap((recipient) => toAddress(recipient) ?? [])

function toMessage(message: GraphMessage): MailThreadMessage {
  const isHtml = message.body?.contentType?.toLowerCase() === "html"
  const content = message.body?.content || null
  return {
    id: message.id,
    subject: message.subject ?? "",
    from: toAddress(message.from),
    to: toAddresses(message.toRecipients),
    cc: toAddresses(message.ccRecipients),
    receivedAt: new Date(message.receivedDateTime as string).toISOString(),
    html: isHtml ? content : null,
    text: isHtml ? null : content,
    attachments: (message.attachments ?? [])
      .filter((attachment) => !attachment.isInline)
      .map((attachment) => ({
        name: attachment.name ?? "",
        size: attachment.size ?? 0,
        contentType: attachment.contentType ?? "application/octet-stream",
      })),
  }
}

async function hiddenFolderIds(accessToken: string) {
  const folders = await Promise.all(
    ["deleteditems", "junkemail"].map((name) =>
      getJson<{ id: string }>(`${GRAPH_BASE}/me/mailFolders/${name}?$select=id`, accessToken)
    )
  )
  return new Set(folders.map((folder) => folder.id))
}

export async function readOutlookThread(
  accessToken: string,
  threadId: string
): Promise<MailThreadMessage[]> {
  // Graph refuses $orderby combined with this filter, so sorting happens below.
  const filter = encodeURIComponent(`conversationId eq '${threadId.replaceAll("'", "''")}'`)
  let url: string | undefined =
    `${GRAPH_BASE}/me/messages?$filter=${filter}&$select=${SELECT}&$expand=${encodeURIComponent(EXPAND)}&$top=50`

  const hidden = await hiddenFolderIds(accessToken)
  const found: GraphMessage[] = []
  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (!url.startsWith(`${GRAPH_BASE}/`)) throw new ProviderError("Unexpected Graph next link")
    const response: MessagesResponse = await getJson(url, accessToken, ID_HEADER)
    found.push(...(response.value ?? []))
    url = response["@odata.nextLink"]
  }

  const visible = found.filter(
    (message) =>
      !message.isDraft && message.receivedDateTime && !hidden.has(message.parentFolderId ?? "")
  )
  if (visible.length === 0) throw new ProviderError("Graph conversation is empty", { status: 404 })
  return visible.map(toMessage).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
}
