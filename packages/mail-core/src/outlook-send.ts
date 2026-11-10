import { mapInChunks, sendJson, textToHtml } from "./http"
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

export async function applyOutlookThreadAction(
  accessToken: string,
  input: { messageIds: string[]; action: MailThreadAction }
) {
  const apply = (id: string) => {
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}`
    if (input.action === "read" || input.action === "unread")
      return sendJson("PATCH", url, accessToken, { isRead: input.action === "read" }, ID_HEADER)
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
