// Safe to import from browsers: no Node APIs here.
import type { Carrier, ShipmentStatus } from "./shipments"
import type { MailUnsubscribe } from "./unsubscribe"

export const MAIL_PROVIDERS = ["gmail", "outlook"] as const
export type MailProviderId = (typeof MAIL_PROVIDERS)[number]

export const isMailProvider = (value: unknown): value is MailProviderId =>
  MAIL_PROVIDERS.includes(value as MailProviderId)

export type MailAccountStatus = "active" | "reauth_required"

/** A connected mailbox as the API shows it to clients. Never contains tokens. */
export type MailAccountView = {
  id: string
  provider: MailProviderId
  email: string
  displayName: string | null
  status: MailAccountStatus
  /** Index into the client's palette, below MAIL_ACCOUNT_COLORS. */
  color: number
  /** Which signatures this mailbox adds. Null means none. */
  signatures: { newId: string | null; replyId: string | null }
  createdAt: string
}

/** A signature the user wrote, like the ones in Gmail and Outlook settings. */
export type MailSignature = {
  id: string
  name: string
  /** Editor HTML. */
  html: string
}

/** Room for a logo or two, which a signature keeps inline. */
export const MAX_SIGNATURE_LENGTH = 1_000_000
export const MAX_SIGNATURES = 50

export const MAIL_ACCOUNT_COLORS = 8

/** The least used colour, so mailboxes only share one when all are taken. */
export function firstFreeColor(used: number[]) {
  const uses = Array.from(
    { length: MAIL_ACCOUNT_COLORS },
    (_, color) => used.filter((value) => value === color).length
  )
  return uses.indexOf(Math.min(...uses))
}

export type InboxSummary = { total: number; unread: number }

/** One inbox line: a conversation, described by its newest message in the inbox. */
export type MailThreadView = {
  /** The newest message's id. Changes when a newer message arrives. */
  id: string
  accountId: string
  subject: string
  snippet: string
  fromName: string | null
  fromEmail: string | null
  receivedAt: string
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
  messageCount: number
  /** Set for folders of sent mail, whose lines name the recipients. */
  to?: MailAddress[]
}

export type MailThreadsPage = { threads: MailThreadView[]; nextCursor: string | null }

export type MailAddress = { name: string | null; email: string }

export type MailAttachmentInfo = { id: string; name: string; size: number; contentType: string }

/** An image the body refers to as `cid:<contentId>`. */
export type MailInlineImage = { id: string; contentId: string; size: number; contentType: string }

/** A file sent along with a message, as standard base64. */
export type MailAttachmentUpload = { name: string; contentType: string; data: string }

/** An image in the body, which refers to it as `cid:<contentId>`. Standard base64. */
export type MailInlineUpload = { contentId: string; name: string; contentType: string; data: string }

/** Safe inside a MIME header and a `cid:` URL. */
export const INLINE_CONTENT_ID = /^[A-Za-z0-9._-]{1,100}@[A-Za-z0-9.-]{1,100}$/

/** Inline pictures still travel in the request itself, so together they stay this small. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/** All files on one message, as Gmail allows. They are uploaded in chunks first. */
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024
/** One chunk per request, comfortably under Vercel's 4.5 MB request limit. */
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024

/** A file already uploaded in chunks, as clients refer to it in a message. */
export type MailAttachmentRef = { uploadId: string; name: string; contentType: string; size: number }

/** A full message as read from the provider. Never stored by the app. */
export type MailThreadMessage = {
  id: string
  subject: string
  from: MailAddress | null
  replyTo: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  receivedAt: string
  /** Untrusted. Must be sanitized and sandboxed before it is displayed. */
  html: string | null
  text: string | null
  attachments: MailAttachmentInfo[]
  inline: MailInlineImage[]
  /** How to leave the mailing list this came from, when it says. */
  unsubscribe?: MailUnsubscribe | null
}

export type MailThreadDetail = { messages: MailThreadMessage[] }

export type MailSyncResult = {
  /** Caught up for now. When false, call again to continue. */
  done: boolean
  /** Another sync holds this account; nothing happened in this call. */
  busy: boolean
  /** The provider asked to slow down. Progress is saved; continue on the next round. */
  rateLimited: boolean
  changed: number
}

/**
 * `inbox` puts a conversation back, out of the archive, spam or trash. `delete`
 * removes it for good; Gmail only allows that with full mailbox access, which
 * this app doesn't ask for, so it is Outlook only.
 */
export const MAIL_THREAD_ACTIONS = ["read", "unread", "archive", "trash", "star", "unstar", "inbox", "spam", "delete"] as const

/** Whether a mailbox can delete mail for good, rather than leaving it in the trash. */
export const canDeleteForever = (provider: MailProviderId) => provider === "outlook"
export type MailThreadAction = (typeof MAIL_THREAD_ACTIONS)[number]

export type MailOutgoing = {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  text: string
  /** The formatted body. `text` stays as the version for clients that can't show HTML. */
  html?: string
  attachments: MailAttachmentUpload[]
  /** Images `html` shows inline. */
  inline?: MailInlineUpload[]
}

export type MailReply = {
  messageId: string
  to: MailAddress[]
  cc: MailAddress[]
  text: string
  html?: string
  attachments: MailAttachmentUpload[]
  inline?: MailInlineUpload[]
}

export type MailForward = {
  messageId: string
  to: MailAddress[]
  cc: MailAddress[]
  text: string
  html?: string
  inline?: MailInlineUpload[]
}

/** Who a reply goes to. The result is shown to the user and sent exactly as shown. */
export function replyRecipients(message: MailThreadMessage, selfEmail: string, all: boolean) {
  const key = (address: MailAddress) => address.email.toLowerCase()
  const self = selfEmail.toLowerCase()
  const fromSelf = message.from !== null && key(message.from) === self
  const primary = fromSelf
    ? message.to
    : message.replyTo.length > 0
      ? message.replyTo
      : message.from
        ? [message.from]
        : []
  if (!all) return { to: primary, cc: [] as MailAddress[] }

  const seen = new Set([self])
  const keepNew = (address: MailAddress) => {
    if (seen.has(key(address))) return false
    seen.add(key(address))
    return true
  }
  const to = [...primary, ...message.to].filter(keepNew)
  return { to, cc: message.cc.filter(keepNew) }
}

/** Reason codes the OAuth callback hands back to the web app in `?error=`. */
export type ConnectErrorCode = "denied" | "expired" | "session" | "missing_scope" | "failed"

/** A saved, unsent message as the drafts list shows it. Read live from the provider. */
export type MailDraftView = {
  /** The provider's draft id. Gmail keeps it across saves; Graph uses the message id. */
  id: string
  accountId: string
  subject: string
  snippet: string
  to: MailAddress[]
  updatedAt: string
  hasAttachments: boolean
}

/** Keeps a draft that answers a conversation in that conversation. Opaque to clients. */
export type MailDraftReply = { threadId: string; inReplyTo?: string; references?: string }

export type MailDraftContent = MailOutgoing & { reply?: MailDraftReply }

export type MailDraft = MailDraftContent & { id: string }

/** A drafts list shows this many per mailbox, newest first. */
export const MAX_LISTED_DRAFTS = 25

/** Worth keeping: a message only becomes a draft once its subject or text is started. */
export const isDraftWorthKeeping = (draft: { subject: string; text: string }) =>
  Boolean(draft.subject.trim() || draft.text.trim())

/** A conversation search found, read live. It may be outside the synced inbox. */
export type MailSearchHit = {
  accountId: string
  /** The provider's conversation id. */
  threadId: string
  subject: string
  snippet: string
  fromName: string | null
  fromEmail: string | null
  receivedAt: string
  isRead: boolean
  hasAttachments: boolean
  isStarred?: boolean
  /** Who the newest message went to; folders of sent mail show this instead. */
  to?: MailAddress[]
  /** The newest synced message, when the conversation is in the inbox list. */
  messageId?: string
}

/** Folders read live from the provider. The inbox is synced; drafts have their own list. */
export const MAIL_FOLDERS = ["starred", "sent", "archive", "spam", "trash"] as const
export type MailFolder = (typeof MAIL_FOLDERS)[number]
export const isMailFolder = (value: unknown): value is MailFolder => MAIL_FOLDERS.includes(value as MailFolder)
/** Spam and trash are hidden from normal reading, so opening one has to ask for them. */
export const HIDDEN_FOLDERS: readonly MailFolder[] = ["spam", "trash"]


/** Each mailbox returns at most this many conversations per search. */
export const MAX_SEARCH_HITS = 15
export const MAX_SEARCH_LENGTH = 500

/** Words that rank results. Operators such as from:x are for the provider only. */
export const searchWords = (query: string) =>
  query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((word) => word && !word.includes(":"))

/**
 * Best matches first: every word in the sender, then in the subject, then the
 * rest, which is usually a mention in the text such as a footer link. Newest first
 * within each. Duplicates of a conversation keep their first copy.
 */
export function rankSearchHits(query: string, hits: MailSearchHit[]) {
  const words = searchWords(query)
  const covers = (value: string) => {
    const text = value.toLocaleLowerCase()
    return words.length > 0 && words.every((word) => text.includes(word))
  }
  const score = (hit: MailSearchHit) =>
    covers(`${hit.fromName ?? ""} ${hit.fromEmail ?? ""}`) ? 2 : covers(hit.subject) ? 1 : 0
  const seen = new Set<string>()
  return hits
    .filter((hit) => {
      const key = `${hit.accountId}:${hit.threadId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((hit) => ({ hit, score: score(hit) }))
    .sort((a, b) => b.score - a.score || b.hit.receivedAt.localeCompare(a.hit.receivedAt))
    .map(({ hit }) => hit)
}

/** What the reading pane shows above a conversation. */
/** A parcel followed in the mail, for the Parcels view and above its conversation. */
export type MailShipmentView = {
  carrier: Carrier | null
  trackingCode: string | null
  trackingUrl: string | null
  merchant: string | null
  status: ShipmentStatus | null
  /** The newest mail about it: what the list line and the card describe. */
  subject: string
  receivedAt: string
  /** The conversation to open; absent above the conversation itself. */
  thread?: MailThreadView
}

/** Someone who fills the inbox, for tidying up per sender. */
export type MailSenderView = {
  email: string
  name: string | null
  /** Messages from them in the inbox. */
  messages: number
  unread: number
  conversations: number
  latest: string
  /** Their newest message: its provider id, to unsubscribe through. */
  providerMessageId: string
  /** The conversation it is in, to open. */
  thread: MailThreadView | null
}

/** A snoozed conversation, as the Snoozed list and the inbox's top show it. */
export type MailSnoozedView = { thread: MailThreadView; until: string }

/** A message waiting to be sent, as the Scheduled list shows it. */
export type MailScheduledView = {
  id: string
  accountId: string
  draftId: string
  subject: string
  to: MailAddress[]
  sendAt: string
  /** Sending failed; the draft is still there to open. */
  failed: boolean
}

export type MailSummary =
  | { kind: "code"; code: string }
  | { kind: "summary"; summary: string }
  /** Too short to be worth summing up, or no summary service. */
  | { kind: "none" }

/** As the browser sends it: files by the id of their finished upload. */
export type WithAttachmentRefs<T extends { attachments: unknown }> = Omit<T, "attachments"> & {
  attachments: MailAttachmentRef[]
}
export type MailDraftRequest = WithAttachmentRefs<MailDraftContent>
/** An opened draft, its files already copied into uploads. */
export type MailDraftOpened = WithAttachmentRefs<MailDraft>
