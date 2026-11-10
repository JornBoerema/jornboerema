import { randomBytes } from "node:crypto"
import { collect, emptyContent, headerOf, readGmailAttachment, type GmailFullMessage } from "./gmail-read"
import { decodeEntities, GMAIL_API } from "./gmail-sync"
import { getJson, mapInChunks, sendBody, sendJson, textToHtml } from "./http"
import { ProviderError } from "./provider"
import {
  INLINE_CONTENT_ID,
  type MailAddress,
  type MailAttachmentUpload,
  type MailInlineUpload,
  type MailForward,
  type MailOutgoing,
  type MailReply,
  type MailThreadAction,
} from "./types"

const CRLF = "\r\n"
const MAX_QUOTED_HTML = 200_000
const MAX_QUOTED_TEXT = 20_000
const ATTACHMENT_CONCURRENCY = 2

/** A line break in a header value would let it inject further headers. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim()

/** RFC 2047 words stay under the 75 character limit and never split a character. */
function encodeWords(value: string) {
  const words: string[] = []
  let chunk = ""
  for (const char of value) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk)
      chunk = ""
    }
    chunk += char
  }
  words.push(chunk)
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`)
    .join(`${CRLF} `)
}

const isPlainAscii = (value: string) => /^[\x20-\x7e]*$/.test(value)

function headerText(value: string) {
  const clean = oneLine(value)
  return isPlainAscii(clean) ? clean : encodeWords(clean)
}

function formatAddress({ name, email }: MailAddress) {
  const target = oneLine(email)
  if (/[\s<>,;"]/.test(target) || !target.includes("@"))
    throw new ProviderError("Invalid recipient address")
  if (!name) return target
  const display = oneLine(name)
  return isPlainAscii(display)
    ? `"${display.replace(/(["\\])/g, "\\$1")}" <${target}>`
    : `${encodeWords(display)} <${target}>`
}

const formatList = (addresses: MailAddress[]) => addresses.map(formatAddress).join(`,${CRLF} `)

const wrapBase64 = (base64: string) => base64.replace(/.{76}/g, `$&${CRLF}`)

/** RFC 2231, so any file name survives without being able to break out of the header. */
function encodeFileName(name: string) {
  const encoded = encodeURIComponent(oneLine(name)).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `UTF-8''${encoded}`
}

const safeContentType = (value: string) =>
  /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : "application/octet-stream"

function attachmentPart({ name, contentType, data }: MailAttachmentUpload) {
  return [
    `Content-Type: ${safeContentType(contentType)}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename*=${encodeFileName(name)}`,
    "",
    // Re-encoding drops anything in the input that is not base64, such as line breaks.
    wrapBase64(Buffer.from(data, "base64").toString("base64")),
  ].join(CRLF)
}

function textPart(contentType: string, value: string) {
  return [
    `Content-Type: ${contentType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(value, "utf8").toString("base64")),
  ].join(CRLF)
}

function multipart(subtype: string, parts: string[]) {
  const boundary = `evido_${subtype}_${randomBytes(16).toString("hex")}`
  return [
    `Content-Type: multipart/${subtype}; boundary="${boundary}"`,
    "",
    ...parts.map((part) => `--${boundary}${CRLF}${part}`),
    `--${boundary}--`,
    "",
  ].join(CRLF)
}

function inlinePart({ contentId, name, contentType, data }: MailInlineUpload) {
  // The id goes into a header, so only a strict shape is accepted.
  if (!INLINE_CONTENT_ID.test(contentId)) throw new ProviderError("Invalid inline image id")
  return [
    `Content-Type: ${safeContentType(contentType)}`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${contentId}>`,
    `Content-Disposition: inline; filename*=${encodeFileName(name)}`,
    "",
    wrapBase64(Buffer.from(data, "base64").toString("base64")),
  ].join(CRLF)
}

/**
 * The plain version comes first: clients show the last alternative they understand.
 * Inline images sit next to the HTML that shows them, in a related part.
 */
function bodyPart(text: string, html?: string, inline: MailInlineUpload[] = []) {
  const plain = textPart("text/plain", text)
  if (!html) return plain
  const rich = textPart("text/html", html)
  const shown = inline.length > 0 ? multipart("related", [rich, ...inline.map(inlinePart)]) : rich
  return multipart("alternative", [plain, shown])
}

export function buildMime(input: {
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  text: string
  html?: string
  attachments: MailAttachmentUpload[]
  inline?: MailInlineUpload[]
  inReplyTo?: string
  references?: string
}) {
  const headers = [
    `From: ${formatAddress(input.from)}`,
    ...(input.to.length ? [`To: ${formatList(input.to)}`] : []),
    ...(input.cc.length ? [`Cc: ${formatList(input.cc)}`] : []),
    ...(input.bcc.length ? [`Bcc: ${formatList(input.bcc)}`] : []),
    `Subject: ${headerText(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${oneLine(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${oneLine(input.references)}`] : []),
    "MIME-Version: 1.0",
  ]
  const body = bodyPart(input.text, input.html, input.inline)
  if (input.attachments.length === 0) return `${headers.join(CRLF)}${CRLF}${body}`

  const boundary = `evido_${randomBytes(16).toString("hex")}`
  const parts = [body, ...input.attachments.map(attachmentPart)]
  return [
    [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`].join(CRLF),
    "",
    ...parts.map((part) => `--${boundary}${CRLF}${part}`),
    `--${boundary}--`,
    "",
  ].join(CRLF)
}

/**
 * Writes a message to a Gmail resource (`messages/send`, `drafts`, `drafts/{id}`).
 * Attachments go through the upload endpoint, which accepts far larger messages.
 */
export async function writeMime(
  accessToken: string,
  input: {
    method: "POST" | "PUT"
    path: string
    mime: string
    hasAttachments: boolean
    /** Wraps the message: drafts nest it under `message`. */
    wrap?: (message: Record<string, string>) => Record<string, unknown>
    threadId?: string
  }
) {
  const wrap = input.wrap ?? ((message) => message)
  const thread: Record<string, string> = input.threadId ? { threadId: input.threadId } : {}
  if (!input.hasAttachments) {
    const raw = Buffer.from(input.mime, "utf8").toString("base64url")
    return sendJson(input.method, `${GMAIL_API}/${input.path}`, accessToken, wrap({ raw, ...thread }))
  }
  const boundary = `evido_upload_${randomBytes(16).toString("hex")}`
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(wrap(thread)),
    `--${boundary}`,
    "Content-Type: message/rfc822",
    "",
    input.mime,
    `--${boundary}--`,
    "",
  ].join(CRLF)
  return sendBody(
    input.method,
    `https://gmail.googleapis.com/upload/gmail/v1/users/me/${input.path}?uploadType=multipart`,
    accessToken,
    `multipart/related; boundary=${boundary}`,
    body
  )
}

async function send(accessToken: string, mime: string, hasAttachments: boolean, threadId?: string) {
  await writeMime(accessToken, { method: "POST", path: "messages/send", mime, hasAttachments, threadId })
}

/** Files make a message large, so it goes through the upload endpoint. */
export const hasFiles = (input: { attachments: unknown[]; inline?: unknown[] }) =>
  input.attachments.length + (input.inline?.length ?? 0) > 0

export async function sendGmail(accessToken: string, input: MailOutgoing & { from: MailAddress }) {
  await send(accessToken, buildMime(input), hasFiles(input))
}

/** Only used to quote the original in a plain-text reply, so nothing here is rendered. */
export function htmlToText(html: string) {
  return decodeEntities(
    html
      .slice(0, MAX_QUOTED_HTML)
      .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function readableBody(original: GmailFullMessage) {
  const content = emptyContent()
  if (original.payload) collect(original.payload, content)
  return {
    content,
    body: (content.text ?? htmlToText(content.html ?? "")).slice(0, MAX_QUOTED_TEXT),
  }
}

const sentAt = (original: GmailFullMessage) => new Date(Number(original.internalDate ?? 0)).toUTCString()

function quoted(original: GmailFullMessage) {
  const lines = readableBody(original).body.split(/\r?\n/).map((line) => `> ${line}`)
  const who = headerOf(original.payload?.headers, "from") ?? ""
  return [`On ${sentAt(original)}, ${who} wrote:`, ...lines].join(CRLF)
}

function quotedHtml(original: GmailFullMessage) {
  const who = headerOf(original.payload?.headers, "from") ?? ""
  const heading = textToHtml(`On ${sentAt(original)}, ${who} wrote:`)
  const style = "margin:0;padding-left:12px;border-left:2px solid #d0d0d0"
  return `<div>${heading}</div><blockquote style="${style}">${textToHtml(readableBody(original).body)}</blockquote>`
}

const readFull = (accessToken: string, messageId: string) =>
  getJson<GmailFullMessage>(
    `${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=full`,
    accessToken
  )

export async function replyGmail(
  accessToken: string,
  input: MailReply & { from: MailAddress; threadId: string }
) {
  const original = await readFull(accessToken, input.messageId)
  const headers = original.payload?.headers
  const messageId = headerOf(headers, "message-id")
  const subject = headerOf(headers, "subject") ?? ""
  const references = [headerOf(headers, "references"), messageId].filter(Boolean).join(" ")
  const mime = buildMime({
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: [],
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    text: `${input.text}${CRLF}${CRLF}${quoted(original)}`,
    html: input.html && `${input.html}<br>${quotedHtml(original)}`,
    attachments: input.attachments,
    inline: input.inline,
    inReplyTo: messageId,
    references,
  })
  await send(accessToken, mime, hasFiles(input), input.threadId)
}

export async function forwardGmail(
  accessToken: string,
  input: MailForward & { from: MailAddress }
) {
  const original = await readFull(accessToken, input.messageId)
  const headers = original.payload?.headers
  const subject = headerOf(headers, "subject") ?? ""
  const { content, body } = readableBody(original)
  const files = content.attachments.filter((attachment) => attachment.id)
  const attachments = await mapInChunks(files, ATTACHMENT_CONCURRENCY, async (file) => ({
    name: file.name,
    contentType: file.contentType,
    data: Buffer.from(
      await readGmailAttachment(accessToken, { messageId: input.messageId, attachmentId: file.id })
    ).toString("base64"),
  }))
  const summary = [
    "---------- Forwarded message ---------",
    `From: ${headerOf(headers, "from") ?? ""}`,
    `Date: ${sentAt(original)}`,
    `Subject: ${subject}`,
    `To: ${headerOf(headers, "to") ?? ""}`,
    "",
    body,
  ].join(CRLF)
  const mime = buildMime({
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: [],
    subject: /^(fwd?):/i.test(subject) ? subject : `Fwd: ${subject}`,
    text: input.text ? `${input.text}${CRLF}${CRLF}${summary}` : summary,
    html: input.html && `${input.html}<br>${textToHtml(summary)}`,
    attachments,
    inline: input.inline,
  })
  await send(accessToken, mime, hasFiles({ attachments, inline: input.inline }))
}

const LABEL_CHANGES = {
  read: { removeLabelIds: ["UNREAD"] },
  unread: { addLabelIds: ["UNREAD"] },
  archive: { removeLabelIds: ["INBOX"] },
  star: { addLabelIds: ["STARRED"] },
  unstar: { removeLabelIds: ["STARRED"] },
} as const

export async function applyGmailThreadAction(
  accessToken: string,
  input: { threadId: string; messageIds: string[]; action: MailThreadAction }
) {
  const thread = `${GMAIL_API}/threads/${encodeURIComponent(input.threadId)}`
  if (input.action === "trash") {
    await sendJson("POST", `${thread}/trash`, accessToken, {})
    return
  }
  if (input.action === "inbox") {
    // Out of the trash first; a thread in spam only needs its labels changed.
    await sendJson("POST", `${thread}/untrash`, accessToken, {})
    await sendJson("POST", `${thread}/modify`, accessToken, { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] })
    return
  }
  // batchModify accepts at most 1000 ids per call.
  const batches: string[][] = []
  for (let start = 0; start < input.messageIds.length; start += 1000)
    batches.push(input.messageIds.slice(start, start + 1000))
  await mapInChunks(batches, 1, (ids) =>
    sendJson("POST", `${GMAIL_API}/messages/batchModify`, accessToken, {
      ids,
      ...LABEL_CHANGES[input.action as keyof typeof LABEL_CHANGES],
    })
  )
}
