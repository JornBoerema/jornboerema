import { cleanText, deleteResource, getJson, mapInChunks, sendBody, sendJson } from "./http"
import { attachToMessage, toInlineFiles } from "./outlook-send"
import { GRAPH_BASE } from "./outlook-sync"
import { ProviderError } from "./provider"
import {
  MAX_LISTED_DRAFTS,
  type MailAddress,
  type MailDraft,
  type MailDraftContent,
  type MailDraftView,
} from "./types"

const ID_HEADER = { Prefer: 'IdType="ImmutableId"' }
const WRITE_CONCURRENCY = 2

type Recipient = { emailAddress?: { name?: string | null; address?: string | null } }

type GraphDraft = {
  id: string
  subject?: string | null
  bodyPreview?: string | null
  toRecipients?: Recipient[]
  ccRecipients?: Recipient[]
  bccRecipients?: Recipient[]
  lastModifiedDateTime?: string
  hasAttachments?: boolean
  body?: { contentType?: string; content?: string } | null
  attachments?: {
    id: string
    "@odata.type"?: string
    name?: string
    contentType?: string
    isInline?: boolean
    contentBytes?: string
    contentId?: string | null
  }[]
}

const toAddresses = (recipients: Recipient[] | undefined): MailAddress[] =>
  (recipients ?? []).flatMap((recipient) => {
    const email = recipient.emailAddress?.address
    return email ? [{ name: recipient.emailAddress?.name || null, email }] : []
  })

const toRecipients = (addresses: MailAddress[]) =>
  addresses.map(({ name, email }) => ({ emailAddress: { address: email, ...(name && { name }) } }))

const messageUrl = (id: string) => `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}`

export async function listOutlookDrafts(accessToken: string): Promise<Omit<MailDraftView, "accountId">[]> {
  const select = "id,subject,bodyPreview,toRecipients,lastModifiedDateTime,hasAttachments"
  const response = await getJson<{ value?: GraphDraft[] }>(
    `${GRAPH_BASE}/me/mailFolders/drafts/messages?$select=${select}&$orderby=lastModifiedDateTime%20desc&$top=${MAX_LISTED_DRAFTS}`,
    accessToken,
    ID_HEADER
  )
  return (response.value ?? []).map((draft) => ({
    id: draft.id,
    subject: cleanText(draft.subject ?? ""),
    snippet: cleanText(draft.bodyPreview ?? ""),
    to: toAddresses(draft.toRecipients),
    updatedAt: new Date(draft.lastModifiedDateTime ?? 0).toISOString(),
    hasAttachments: Boolean(draft.hasAttachments),
  }))
}

export async function getOutlookDraft(accessToken: string, draftId: string): Promise<MailDraft> {
  const select = "id,subject,toRecipients,ccRecipients,bccRecipients,body"
  const draft = await getJson<GraphDraft>(
    `${messageUrl(draftId)}?$select=${select}&$expand=attachments`,
    accessToken,
    ID_HEADER
  )
  const isHtml = draft.body?.contentType?.toLowerCase() === "html"
  const content = draft.body?.content ?? ""
  return {
    id: draft.id,
    to: toAddresses(draft.toRecipients),
    cc: toAddresses(draft.ccRecipients),
    bcc: toAddresses(draft.bccRecipients),
    subject: draft.subject ?? "",
    text: isHtml ? "" : content,
    ...(isHtml && content && { html: content }),
    // Attached emails and calendar items have no file content to carry over.
    attachments: (draft.attachments ?? []).flatMap((file) =>
      !file.isInline && file.contentBytes
        ? [
            {
              name: file.name ?? "",
              contentType: file.contentType ?? "application/octet-stream",
              data: file.contentBytes,
            },
          ]
        : []
    ),
    inline: (draft.attachments ?? []).flatMap((file) =>
      file.isInline && file.contentBytes && file.contentId
        ? [
            {
              contentId: file.contentId.replace(/^<|>$/g, ""),
              name: file.name ?? "image",
              contentType: file.contentType ?? "application/octet-stream",
              data: file.contentBytes,
            },
          ]
        : []
    ),
  }
}

/** Swaps every file on the draft, inline images included, for the ones given. */
async function replaceAttachments(accessToken: string, draftId: string, input: MailDraftContent) {
  const existing = await getJson<{ value?: { id: string }[] }>(
    `${messageUrl(draftId)}/attachments?$select=id`,
    accessToken,
    ID_HEADER
  )
  await mapInChunks(existing.value ?? [], WRITE_CONCURRENCY, (file) =>
    deleteResource(`${messageUrl(draftId)}/attachments/${encodeURIComponent(file.id)}`, accessToken, ID_HEADER)
  )
  await mapInChunks(toInlineFiles(input.inline), WRITE_CONCURRENCY, (file) =>
    sendJson("POST", `${messageUrl(draftId)}/attachments`, accessToken, file, ID_HEADER)
  )
  // One at a time: a large one goes through its own upload session.
  for (const file of input.attachments) await attachToMessage(accessToken, draftId, file)
}

export async function saveOutlookDraft(
  accessToken: string,
  input: MailDraftContent & { draftId: string | null; attachmentsChanged: boolean }
) {
  const fields = {
    subject: input.subject,
    body: input.html
      ? { contentType: "HTML", content: input.html }
      : { contentType: "Text", content: input.text },
    toRecipients: toRecipients(input.to),
    ccRecipients: toRecipients(input.cc),
    bccRecipients: toRecipients(input.bcc),
  }
  if (!input.draftId) {
    const response = await sendJson(
      "POST",
      `${GRAPH_BASE}/me/messages`,
      accessToken,
      { ...fields, attachments: toInlineFiles(input.inline) },
      ID_HEADER
    )
    const created = (await response.json()) as { id?: string }
    if (!created.id) throw new ProviderError("Graph draft has no id")
    for (const file of input.attachments) await attachToMessage(accessToken, created.id, file)
    return created.id
  }
  await sendJson("PATCH", messageUrl(input.draftId), accessToken, fields, ID_HEADER)
  if (input.attachmentsChanged) await replaceAttachments(accessToken, input.draftId, input)
  return input.draftId
}

export async function sendOutlookDraft(accessToken: string, draftId: string) {
  // Graph wants no body here at all.
  await sendBody("POST", `${messageUrl(draftId)}/send`, accessToken, "application/json", "", ID_HEADER)
}

/** Graph draft ids are message ids, so this checks it really is a draft before deleting. */
export async function deleteOutlookDraft(accessToken: string, draftId: string) {
  let message: { isDraft?: boolean }
  try {
    message = await getJson(`${messageUrl(draftId)}?$select=isDraft`, accessToken, ID_HEADER)
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) return
    throw error
  }
  if (!message.isDraft) throw new ProviderError("Not a draft", { status: 404 })
  await deleteResource(messageUrl(draftId), accessToken, ID_HEADER)
}
