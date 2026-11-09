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
  createdAt: string
}

export type InboxSummary = { total: number; unread: number }

/** One inbox line. Bodies are fetched from the provider when a message is opened. */
export type MailMessageView = {
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
}

export type MailMessagesPage = { messages: MailMessageView[]; nextCursor: string | null }

export type MailSyncResult = {
  /** Caught up for now. When false, call again to continue. */
  done: boolean
  /** Another sync holds this account; nothing happened in this call. */
  busy: boolean
  /** The provider asked to slow down. Progress is saved; continue on the next round. */
  rateLimited: boolean
  changed: number
}

/** Reason codes the OAuth callback hands back to the web app in `?error=`. */
export type ConnectErrorCode = "denied" | "expired" | "session" | "missing_scope" | "failed"
