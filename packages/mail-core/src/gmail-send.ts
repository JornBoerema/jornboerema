import { randomBytes } from "node:crypto"
import { collect, emptyContent, headerOf, readGmailAttachment, type GmailFullMessage } from "./gmail-read"
import { decodeEntities, GMAIL_API } from "./gmail-sync"
import { getJson, mapInChunks, sendBody, sendJson } from "./http"
import { ProviderError } from "./provider"
import type {
  MailAddress,
  MailAttachmentUpload,
  MailForward,
  MailOutgoing,
  MailReply,
  MailThreadAction,
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

function buildMime(input: {
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  text: string
  attachments: MailAttachmentUpload[]
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
  const textHeaders = ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"]
  const textBody = wrapBase64(Buffer.from(input.text, "utf8").toString("base64"))
  if (input.attachments.length === 0)
    return `${[...headers, ...textHeaders].join(CRLF)}${CRLF}${CRLF}${textBody}`

  const boundary = `evido_${randomBytes(16).toString("hex")}`
  const parts = [[...textHeaders, "", textBody].join(CRLF), ...input.attachments.map(attachmentPart)]
  return [
    [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`].join(CRLF),
    "",
    ...parts.map((part) => `--${boundary}${CRLF}${part}`),
    `--${boundary}--`,
    "",
  ].join(CRLF)
}

/** Attachments go through the upload endpoint, which accepts far larger messages. */
async function send(accessToken: string, mime: string, hasAttachments: boolean, threadId?: string) {
  if (!hasAttachments) {
    const raw = Buffer.from(mime, "utf8").toString("base64url")
    await sendJson("POST", `${GMAIL_API}/messages/send`, accessToken, {
      raw,
      ...(threadId && { threadId }),
    })
    return
  }
  const boundary = `evido_upload_${randomBytes(16).toString("hex")}`
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(threadId ? { threadId } : {}),
    `--${boundary}`,
    "Content-Type: message/rfc822",
    "",
    mime,
    `--${boundary}--`,
    "",
  ].join(CRLF)
  await sendBody(
    "POST",
    "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart",
    accessToken,
    `multipart/related; boundary=${boundary}`,
    body
  )
}

export async function sendGmail(accessToken: string, input: MailOutgoing & { from: MailAddress }) {
  await send(accessToken, buildMime(input), input.attachments.length > 0)
}

/** Only used to quote the original in a plain-text reply, so nothing here is rendered. */
function htmlToText(html: string) {
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
    attachments: input.attachments,
    inReplyTo: messageId,
    references,
  })
  await send(accessToken, mime, input.attachments.length > 0, input.threadId)
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
    attachments,
  })
  await send(accessToken, mime, attachments.length > 0)
}

const LABEL_CHANGES = {
  read: { removeLabelIds: ["UNREAD"] },
  unread: { addLabelIds: ["UNREAD"] },
  archive: { removeLabelIds: ["INBOX"] },
} as const

export async function applyGmailThreadAction(
  accessToken: string,
  input: { threadId: string; messageIds: string[]; action: MailThreadAction }
) {
  if (input.action === "trash") {
    await sendJson(
      "POST",
      `${GMAIL_API}/threads/${encodeURIComponent(input.threadId)}/trash`,
      accessToken,
      {}
    )
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
