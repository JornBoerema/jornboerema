import { getJson, mapInChunks, sendJson, textToHtml } from "./http"
import { GRAPH_BASE } from "./outlook-sync"
import { ProviderError } from "./provider"
import type {
  MailAddress,
  MailAttachmentUpload,
  MailInlineUpload,
  MailForward,
  MailOutgoing,
  MailReply,
  MailThreadAction,
} from "./types"

const WRITE_CONCURRENCY = 4
const ID_HEADER = { Prefer: 'IdType="ImmutableId"' }

const toRecipients = (addresses: MailAddress[]) =>
  addresses.map(({ name, email }) => ({
    emailAddress: { address: email, ...(name && { name }) },
  }))

const toFiles = (attachments: MailAttachmentUpload[]) =>
  attachments.map(({ name, contentType, data }) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name,
    contentType,
    contentBytes: data,
  }))

/** Images the HTML shows through `cid:` links. */
export const toInlineFiles = (images: MailInlineUpload[] = []) =>
  images.map(({ contentId, name, contentType, data }) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name,
    contentType,
    contentBytes: data,
    contentId,
    isInline: true,
  }))

const allFiles = (input: { attachments: MailAttachmentUpload[]; inline?: MailInlineUpload[] }) => [
  ...toFiles(input.attachments),
  ...toInlineFiles(input.inline),
]

export async function sendOutlook(accessToken: string, input: MailOutgoing) {
  await sendJson("POST", `${GRAPH_BASE}/me/sendMail`, accessToken, {
    message: {
      subject: input.subject,
      body: input.html
        ? { contentType: "HTML", content: input.html }
        : { contentType: "Text", content: input.text },
      toRecipients: toRecipients(input.to),
      ccRecipients: toRecipients(input.cc),
      bccRecipients: toRecipients(input.bcc),
      ...(allFiles(input).length > 0 && { attachments: allFiles(input) }),
    },
    saveToSentItems: true,
  })
}

/** Graph adds the quoted original and the threading headers itself. */
export async function replyOutlook(accessToken: string, input: MailReply) {
  await sendJson(
    "POST",
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(input.messageId)}/reply`,
    accessToken,
    {
      comment: input.html ?? textToHtml(input.text),
      message: {
        toRecipients: toRecipients(input.to),
        ccRecipients: toRecipients(input.cc),
        ...(allFiles(input).length > 0 && { attachments: allFiles(input) }),
      },
    },
    ID_HEADER
  )
}

/** Graph includes the original and its attachments itself. */
export async function forwardOutlook(accessToken: string, input: MailForward) {
  await sendJson(
    "POST",
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(input.messageId)}/forward`,
    accessToken,
    {
      comment: input.html ?? textToHtml(input.text),
      toRecipients: [...toRecipients(input.to), ...toRecipients(input.cc)],
      ...(input.inline?.length && { message: { attachments: toInlineFiles(input.inline) } }),
    },
    ID_HEADER
  )
}

/** Puts the conversation's messages that were moved away back in the inbox. Sent mail stays put. */
async function moveBackToInbox(accessToken: string, threadId: string) {
  const folders = await Promise.all(
    ["deleteditems", "junkemail", "archive"].map((name) =>
      getJson<{ id: string }>(`${GRAPH_BASE}/me/mailFolders/${name}?$select=id`, accessToken, ID_HEADER).catch(
        () => null
      )
    )
  )
  const away = new Set(folders.flatMap((folder) => (folder ? [folder.id] : [])))
  const filter = encodeURIComponent(`conversationId eq '${threadId.replaceAll("'", "''")}'`)
  const found = await getJson<{ value?: { id: string; parentFolderId?: string }[] }>(
    `${GRAPH_BASE}/me/messages?$filter=${filter}&$select=id,parentFolderId&$top=100`,
    accessToken,
    ID_HEADER
  )
  const ids = (found.value ?? []).filter((message) => away.has(message.parentFolderId ?? "")).map((message) => message.id)
  await mapInChunks(ids, WRITE_CONCURRENCY, (id) =>
    sendJson("POST", `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/move`, accessToken, { destinationId: "inbox" }, ID_HEADER)
  )
}

export async function applyOutlookThreadAction(
  accessToken: string,
  input: { threadId: string; messageIds: string[]; action: MailThreadAction }
) {
  if (input.action === "inbox") return moveBackToInbox(accessToken, input.threadId)
  const apply = (id: string) => {
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}`
    if (input.action === "read" || input.action === "unread")
      return sendJson("PATCH", url, accessToken, { isRead: input.action === "read" }, ID_HEADER)
    // Outlook's flag is what Gmail calls a star.
    if (input.action === "star" || input.action === "unstar")
      return sendJson(
        "PATCH",
        url,
        accessToken,
        { flag: { flagStatus: input.action === "star" ? "flagged" : "notFlagged" } },
        ID_HEADER
      )
    const destinationId = input.action === "archive" ? "archive" : "deleteditems"
    return sendJson("POST", `${url}/move`, accessToken, { destinationId }, ID_HEADER)
  }
  // Graph has no conversation-wide change, so each message is handled on its own.
  await mapInChunks(input.messageIds, WRITE_CONCURRENCY, async (id) => {
    try {
      await apply(id)
    } catch (error) {
      // Already gone from the mailbox: the outcome the user asked for.
      if (!(error instanceof ProviderError && error.status === 404)) throw error
    }
  })
}
