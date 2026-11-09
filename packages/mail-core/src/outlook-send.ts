import { mapInChunks, sendJson } from "./http"
import { GRAPH_BASE } from "./outlook-sync"
import { ProviderError } from "./provider"
import type {
  MailAddress,
  MailAttachmentUpload,
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

/** Graph treats a reply comment as HTML, so user text must not be able to become markup. */
const textToHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replace(/\r?\n/g, "<br>")

const toFiles = (attachments: MailAttachmentUpload[]) =>
  attachments.map(({ name, contentType, data }) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name,
    contentType,
    contentBytes: data,
  }))

export async function sendOutlook(accessToken: string, input: MailOutgoing) {
  await sendJson("POST", `${GRAPH_BASE}/me/sendMail`, accessToken, {
    message: {
      subject: input.subject,
      body: { contentType: "Text", content: input.text },
      toRecipients: toRecipients(input.to),
      ccRecipients: toRecipients(input.cc),
      bccRecipients: toRecipients(input.bcc),
      ...(input.attachments.length > 0 && { attachments: toFiles(input.attachments) }),
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
      comment: textToHtml(input.text),
      message: {
        toRecipients: toRecipients(input.to),
        ccRecipients: toRecipients(input.cc),
        ...(input.attachments.length > 0 && { attachments: toFiles(input.attachments) }),
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
      comment: textToHtml(input.text),
      toRecipients: [...toRecipients(input.to), ...toRecipients(input.cc)],
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
