import type { InboxSummary, MailProviderId } from "./types"

export type ProviderCredentials = { clientId: string; clientSecret: string }

export type TokenSet = {
  accessToken: string
  /** Absent when the provider keeps the existing refresh token valid (Google on refresh). */
  refreshToken?: string
  expiresAt: Date
  scope: string
}

export type MailIdentity = {
  /** Stable provider id of the mailbox owner; survives address changes. */
  providerAccountId: string
  email: string
  displayName: string | null
}

/** The list metadata kept for one message. Bodies are never part of this. */
export type MailMessageData = {
  providerMessageId: string
  threadId: string | null
  subject: string
  snippet: string
  fromName: string | null
  fromEmail: string | null
  receivedAt: Date
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
}

export type SyncPage = {
  upserts: MailMessageData[]
  /** Messages that were deleted or left the inbox. */
  removals: string[]
  /** Where the next call continues. Store it together with this page's changes. */
  cursor: string
  /** True when the mailbox is caught up for now. */
  done: boolean
}

export interface MailProvider {
  readonly id: MailProviderId
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>
  refresh(refreshToken: string): Promise<TokenSet>
  identity(accessToken: string): Promise<MailIdentity>
  inboxSummary(accessToken: string): Promise<InboxSummary>
  /** One step of the inbox sync. A null cursor starts a full sync from `since`. */
  syncPage(accessToken: string, input: { cursor: string | null; since: Date }): Promise<SyncPage>
  /** Best effort. Providers without a revoke endpoint leave this out. */
  revoke?(refreshToken: string): Promise<void>
}

/** The grant is gone (revoked, expired, password changed): the user must connect again. */
export class ReauthRequiredError extends Error {}

/** The user unticked a permission the app cannot work without. */
export class MissingScopeError extends Error {}

/** The provider failed or answered unexpectedly. Worth retrying later. */
export class ProviderError extends Error {
  status?: number
  code?: string

  constructor(message: string, details?: { status?: number; code?: string }) {
    super(message)
    this.status = details?.status
    this.code = details?.code
  }
}

/** Temporary and expected during large syncs; the right response is to wait. */
export const isRateLimited = (error: unknown) =>
  error instanceof ProviderError &&
  (error.status === 429 || (error.status === 403 && /ratelimit/i.test(error.code ?? "")))

/** The provider no longer knows this position: the mailbox needs a full sync. */
export class SyncCursorExpiredError extends Error {}
