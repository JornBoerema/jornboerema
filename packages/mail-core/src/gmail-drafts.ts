import { collect, emptyContent, headerOf, readGmailAttachment, toAddresses, type GmailFullMessage } from "./gmail-read"
import { buildMime, hasFiles, writeMime } from "./gmail-send"
import { decodeEntities, GMAIL_API } from "./gmail-sync"
import { cleanText, deleteResource, getJson, mapInChunks, sendJson } from "./http"
import { ProviderError } from "./provider"
import {
  MAX_LISTED_DRAFTS,
  type MailAddress,
  type MailDraft,
  type MailDraftContent,
  type MailDraftView,
} from "./types"

// Same budget as the sync: each read costs 5 of the 250 quota units per second.
const READ_CONCURRENCY = 3
const ATTACHMENT_CONCURRENCY = 2

type GmailDraft = { id: string; message?: GmailFullMessage & { snippet?: string } }

const draftUrl = (draftId: string, format: string) =>
  `${GMAIL_API}/drafts/${encodeURIComponent(draftId)}?format=${format}`

export async function listGmailDrafts(accessToken: string): Promise<Omit<MailDraftView, "accountId">[]> {
  const list = await getJson<{ drafts?: { id: string }[] }>(
    `${GMAIL_API}/drafts?maxResults=${MAX_LISTED_DRAFTS}`,
    accessToken
  )
  const drafts = await mapInChunks(list.drafts ?? [], READ_CONCURRENCY, async ({ id }) => {
    try {
      return await getJson<GmailDraft>(
        `${draftUrl(id, "metadata")}&metadataHeaders=To&metadataHeaders=Subject`,
        accessToken
      )
    } catch (error) {
      // Sent or deleted between listing and reading.
      if (error instanceof ProviderError && error.status === 404) return null
      throw error
    }
  })
  return drafts.flatMap((draft) => {
    const message = draft?.message
    if (!draft || !message) return []
    const headers = message.payload?.headers
    return [
      {
        id: draft.id,
        subject: cleanText(headerOf(headers, "subject") ?? ""),
        snippet: cleanText(decodeEntities(message.snippet ?? "")),
        to: toAddresses(headerOf(headers, "to")),
        updatedAt: new Date(Number(message.internalDate ?? 0)).toISOString(),
        hasAttachments: message.payload?.mimeType === "multipart/mixed",
      },
    ]
  })
}

export async function getGmailDraft(accessToken: string, draftId: string): Promise<MailDraft> {
  const draft = await getJson<GmailDraft>(draftUrl(draftId, "full"), accessToken)
  const message = draft.message
  if (!message) throw new ProviderError("Gmail draft has no message", { status: 404 })
  const content = emptyContent()
  if (message.payload) collect(message.payload, content)
  const headers = message.payload?.headers
  const attachments = await mapInChunks(
    content.attachments.filter((file) => file.id),
    ATTACHMENT_CONCURRENCY,
    async (file) => ({
      name: file.name,
      contentType: file.contentType,
      data: Buffer.from(
        await readGmailAttachment(accessToken, { messageId: message.id, attachmentId: file.id })
      ).toString("base64"),
    })
  )
  const inline = await mapInChunks(
    content.inline.filter((image) => image.id && image.contentId),
    ATTACHMENT_CONCURRENCY,
    async (image) => ({
      contentId: image.contentId,
      name: image.contentId,
      contentType: image.contentType,
      data: Buffer.from(
        await readGmailAttachment(accessToken, { messageId: message.id, attachmentId: image.id })
      ).toString("base64"),
    })
  )
  const inReplyTo = headerOf(headers, "in-reply-to")
  return {
    id: draft.id,
    to: toAddresses(headerOf(headers, "to")),
    cc: toAddresses(headerOf(headers, "cc")),
    bcc: toAddresses(headerOf(headers, "bcc")),
    subject: headerOf(headers, "subject") ?? "",
    text: content.text ?? "",
    ...(content.html && { html: content.html }),
    attachments,
    ...(inline.length > 0 && { inline }),
    // Only a draft that answers something needs to stay in its conversation.
    ...(inReplyTo &&
      message.threadId && {
        reply: { threadId: message.threadId, inReplyTo, references: headerOf(headers, "references") },
      }),
  }
}

export async function saveGmailDraft(
  accessToken: string,
  input: MailDraftContent & { from: MailAddress; draftId: string | null }
) {
  const mime = buildMime({
    ...input,
    inReplyTo: input.reply?.inReplyTo,
    references: input.reply?.references,
  })
  // An update replaces the whole message, attachments included, and keeps the draft id.
  const response = await writeMime(accessToken, {
    method: input.draftId ? "PUT" : "POST",
    path: input.draftId ? `drafts/${encodeURIComponent(input.draftId)}` : "drafts",
    mime,
    hasAttachments: hasFiles(input),
    threadId: input.reply?.threadId,
    wrap: (message) => ({ message }),
  })
  const saved = (await response.json()) as { id?: string }
  if (!saved.id) throw new ProviderError("Gmail draft has no id")
  return saved.id
}

export async function sendGmailDraft(accessToken: string, draftId: string) {
  await sendJson("POST", `${GMAIL_API}/drafts/send`, accessToken, { id: draftId })
}

export async function deleteGmailDraft(accessToken: string, draftId: string) {
  await deleteResource(`${GMAIL_API}/drafts/${encodeURIComponent(draftId)}`, accessToken)
}
