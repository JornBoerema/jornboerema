// Safe to import from browsers: no Node APIs here.

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
  signature: MailSignature
  createdAt: string
}

/** Added below what the user writes, like the signatures in Gmail and Outlook. */
export type MailSignature = {
  /** Editor HTML. Empty means no signature. */
  html: string
  forNew: boolean
  forReplies: boolean
}

export const MAX_SIGNATURE_LENGTH = 20_000

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
}

export type MailThreadsPage = { threads: MailThreadView[]; nextCursor: string | null }

export type MailAddress = { name: string | null; email: string }

export type MailAttachmentInfo = { id: string; name: string; size: number; contentType: string }

/** An image the body refers to as `cid:<contentId>`. */
export type MailInlineImage = { id: string; contentId: string; size: number; contentType: string }

/** A file sent along with a message, as standard base64. */
export type MailAttachmentUpload = { name: string; contentType: string; data: string }

/** Graph takes up to 3 MB directly; Vercel rejects larger request bodies once base64-encoded. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

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

export const MAIL_THREAD_ACTIONS = ["read", "unread", "archive", "trash"] as const
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
}

export type MailReply = {
  messageId: string
  to: MailAddress[]
  cc: MailAddress[]
  text: string
  html?: string
  attachments: MailAttachmentUpload[]
}

export type MailForward = {
  messageId: string
  to: MailAddress[]
  cc: MailAddress[]
  text: string
  html?: string
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
