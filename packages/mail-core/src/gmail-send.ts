import { collect, headerOf, type Content, type GmailFullMessage } from "./gmail-read"
import { decodeEntities, GMAIL_API } from "./gmail-sync"
import { getJson, mapInChunks, sendJson } from "./http"
import { ProviderError } from "./provider"
import type { MailAddress, MailOutgoing, MailReply, MailThreadAction } from "./types"

const CRLF = "\r\n"
const MAX_QUOTED_HTML = 200_000
const MAX_QUOTED_TEXT = 20_000

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

function buildMime(input: {
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  text: string
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
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ]
  const body = Buffer.from(input.text, "utf8").toString("base64").replace(/.{76}/g, `$&${CRLF}`)
  return Buffer.from(`${headers.join(CRLF)}${CRLF}${CRLF}${body}`, "utf8").toString("base64url")
}

const send = (accessToken: string, raw: string, threadId?: string) =>
  sendJson("POST", `${GMAIL_API}/messages/send`, accessToken, { raw, ...(threadId && { threadId }) })

export async function sendGmail(accessToken: string, input: MailOutgoing & { from: MailAddress }) {
  await send(accessToken, buildMime(input))
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

function quoted(original: GmailFullMessage) {
  const content: Content = { html: null, text: null, attachments: [] }
  if (original.payload) collect(original.payload, content)
  const body = (content.text ?? htmlToText(content.html ?? "")).slice(0, MAX_QUOTED_TEXT)
  const when = new Date(Number(original.internalDate ?? 0)).toUTCString()
  const who = headerOf(original.payload?.headers, "from") ?? ""
  const lines = body.split(/\r?\n/).map((line) => `> ${line}`)
  return [`On ${when}, ${who} wrote:`, ...lines].join(CRLF)
}

export async function replyGmail(
  accessToken: string,
  input: MailReply & { from: MailAddress; threadId: string }
) {
  const original = await getJson<GmailFullMessage>(
    `${GMAIL_API}/messages/${encodeURIComponent(input.messageId)}?format=full`,
    accessToken
  )
  const headers = original.payload?.headers
  const messageId = headerOf(headers, "message-id")
  const subject = headerOf(headers, "subject") ?? ""
  const references = [headerOf(headers, "references"), messageId].filter(Boolean).join(" ")
  const raw = buildMime({
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: [],
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    text: `${input.text}${CRLF}${CRLF}${quoted(original)}`,
    inReplyTo: messageId,
    references,
  })
  await send(accessToken, raw, input.threadId)
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
