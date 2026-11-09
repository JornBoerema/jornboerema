import { GMAIL_API, parseAddress } from "./gmail-sync"
import { getJson } from "./http"
import { ProviderError } from "./provider"
import type { MailAddress, MailAttachmentInfo, MailThreadMessage } from "./types"

const HIDDEN_LABELS = ["DRAFT", "SPAM", "TRASH"]

type Header = { name?: string; value?: string }

type Part = {
  mimeType?: string
  filename?: string
  headers?: Header[]
  body?: { data?: string; size?: number }
  parts?: Part[]
}

type GmailThread = {
  messages?: { id: string; labelIds?: string[]; internalDate?: string; payload?: Part }[]
}

type Content = { html: string | null; text: string | null; attachments: MailAttachmentInfo[] }

const headerOf = (headers: Header[] | undefined, name: string) =>
  headers?.find((item) => item.name?.toLowerCase() === name)?.value

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8")

/** Splits on the commas between addresses, not those inside "Last, First". */
function splitAddresses(value: string) {
  const items: string[] = []
  let current = ""
  let quoted = false
  let bracketed = false
  for (const char of value) {
    if (char === '"') quoted = !quoted
    else if (char === "<") bracketed = true
    else if (char === ">") bracketed = false
    if (char === "," && !quoted && !bracketed) {
      items.push(current)
      current = ""
    } else current += char
  }
  items.push(current)
  return items
}

function toAddress(value: string | undefined): MailAddress | null {
  const { name, email } = parseAddress(value)
  return email ? { name, email } : null
}

const toAddresses = (value: string | undefined): MailAddress[] =>
  value ? splitAddresses(value).flatMap((item) => toAddress(item) ?? []) : []

/** Inline images belong to the body, so they are not listed as attachments. */
function isInlineImage(part: Part) {
  const disposition = headerOf(part.headers, "content-disposition") ?? ""
  return (
    Boolean(headerOf(part.headers, "content-id")) &&
    Boolean(part.mimeType?.startsWith("image/")) &&
    !disposition.toLowerCase().startsWith("attachment")
  )
}

function collect(part: Part, content: Content) {
  if (part.filename) {
    if (!isInlineImage(part))
      content.attachments.push({
        name: part.filename,
        size: part.body?.size ?? 0,
        contentType: part.mimeType ?? "application/octet-stream",
      })
  } else if (part.body?.data && part.mimeType === "text/html") {
    content.html ??= decode(part.body.data)
  } else if (part.body?.data && part.mimeType === "text/plain") {
    content.text ??= decode(part.body.data)
  }
  for (const child of part.parts ?? []) collect(child, content)
}

export async function readGmailThread(
  accessToken: string,
  threadId: string
): Promise<MailThreadMessage[]> {
  const thread = await getJson<GmailThread>(
    `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=full`,
    accessToken
  )
  const messages = (thread.messages ?? []).filter(
    (message) => !message.labelIds?.some((label) => HIDDEN_LABELS.includes(label))
  )
  if (messages.length === 0) throw new ProviderError("Gmail thread is empty", { status: 404 })

  return messages
    .map((message) => {
      const content: Content = { html: null, text: null, attachments: [] }
      if (message.payload) collect(message.payload, content)
      const headers = message.payload?.headers
      return {
        id: message.id,
        subject: headerOf(headers, "subject") ?? "",
        from: toAddress(headerOf(headers, "from")),
        to: toAddresses(headerOf(headers, "to")),
        cc: toAddresses(headerOf(headers, "cc")),
        receivedAt: new Date(Number(message.internalDate ?? 0)).toISOString(),
        ...content,
      }
    })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
}
