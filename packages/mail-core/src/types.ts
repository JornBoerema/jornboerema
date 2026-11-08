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

/** Reason codes the OAuth callback hands back to the web app in `?error=`. */
export type ConnectErrorCode = "denied" | "expired" | "session" | "missing_scope" | "failed"
