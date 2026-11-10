import { getJson, mapInChunks, sendBody, sendJson, textToHtml } from "./http"
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

/** Graph takes a file this big directly; larger ones need an upload session. */
const DIRECT_ATTACHMENT_BYTES = 3 * 1024 * 1024
/** Upload session chunks must be multiples of 320 KiB; this is 12 of them. */
const SESSION_CHUNK_BYTES = 12 * 320 * 1024

const bytesOf = (file: { data: string }) => Math.floor((file.data.length * 3) / 4)

/** Too big for one JSON request to Graph, which caps those at about 4 MB. */
export const needsUploadSessions = (files: { data: string }[]) =>
  files.reduce((sum, file) => sum + bytesOf(file), 0) > DIRECT_ATTACHMENT_BYTES

/**
 * Puts a file on a draft: directly when small, through an upload session when not.
 * The session URL is pre-authorised, so it must not get the bearer token.
 */
export async function attachToMessage(accessToken: string, messageId: string, file: MailAttachmentUpload) {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments`
  const bytes = Buffer.from(file.data, "base64")
  if (bytes.length <= DIRECT_ATTACHMENT_BYTES) {
    await sendJson("POST", url, accessToken, toFiles([file])[0], ID_HEADER)
    return
  }
  const session = await sendJson(
    "POST",
    `${url}/createUploadSession`,
    accessToken,
    { AttachmentItem: { attachmentType: "file", name: file.name, size: bytes.length, contentType: file.contentType } },
    ID_HEADER
  )
  const { uploadUrl } = (await session.json()) as { uploadUrl?: string }
  if (!uploadUrl?.startsWith("https://")) throw new ProviderError("Graph upload session has no URL")
  for (let start = 0; start < bytes.length; start += SESSION_CHUNK_BYTES) {
    const chunk = bytes.subarray(start, Math.min(start + SESSION_CHUNK_BYTES, bytes.length))
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${bytes.length}`,
      },
      body: chunk,
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new ProviderError(`Graph upload answered ${response.status}`, { status: response.status })
  }
}

const messageFields = (input: MailOutgoing) => ({
  subject: input.subject,
  body: input.html ? { contentType: "HTML", content: input.html } : { contentType: "Text", content: input.text },
  toRecipients: toRecipients(input.to),
  ccRecipients: toRecipients(input.cc),
  bccRecipients: toRecipients(input.bcc),
})

export async function sendOutlook(accessToken: string, input: MailOutgoing) {
  // Large files can't go in one request: build a draft, attach them, then send it.
  if (needsUploadSessions(input.attachments)) {
    const created = await sendJson("POST", `${GRAPH_BASE}/me/messages`, accessToken, {
      ...messageFields(input),
      attachments: toInlineFiles(input.inline),
    }, ID_HEADER)
    const { id } = (await created.json()) as { id?: string }
    if (!id) throw new ProviderError("Graph draft has no id")
    for (const file of input.attachments) await attachToMessage(accessToken, id, file)
    await sendBody("POST", `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/send`, accessToken, "application/json", "", ID_HEADER)
    return
  }
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
  if (needsUploadSessions(input.attachments)) {
    // createReply makes the same reply as a draft, which can then take large files.
    const draft = await sendJson(
      "POST",
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(input.messageId)}/createReply`,
      accessToken,
      {
        comment: input.html ?? textToHtml(input.text),
        message: {
          toRecipients: toRecipients(input.to),
          ccRecipients: toRecipients(input.cc),
          attachments: toInlineFiles(input.inline),
        },
      },
      ID_HEADER
    )
    const { id } = (await draft.json()) as { id?: string }
    if (!id) throw new ProviderError("Graph reply draft has no id")
    for (const file of input.attachments) await attachToMessage(accessToken, id, file)
    await sendBody("POST", `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/send`, accessToken, "application/json", "", ID_HEADER)
    return
  }
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
    // Gone for good, not even in Deleted Items.
    if (input.action === "delete") return sendJson("POST", `${url}/permanentDelete`, accessToken, {}, ID_HEADER)
    const destinationId = input.action === "archive" ? "archive" : input.action === "spam" ? "junkemail" : "deleteditems"
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

/** One page of the trash: every message in it deleted for good. */
const EMPTY_PAGE = 50

export async function emptyOutlookTrash(accessToken: string) {
  const page = await getJson<{ value?: { id: string }[] }>(
    `${GRAPH_BASE}/me/mailFolders/deleteditems/messages?$select=id&$top=${EMPTY_PAGE}`,
    accessToken,
    ID_HEADER
  )
  const ids = (page.value ?? []).map((message) => message.id)
  await mapInChunks(ids, WRITE_CONCURRENCY, async (id) => {
    try {
      await sendJson("POST", `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/permanentDelete`, accessToken, {}, ID_HEADER)
    } catch (error) {
      if (!(error instanceof ProviderError && error.status === 404)) throw error
    }
  })
  return { deleted: ids.length, done: ids.length < EMPTY_PAGE }
}
