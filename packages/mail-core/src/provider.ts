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

export interface MailProvider {
  readonly id: MailProviderId
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>
  refresh(refreshToken: string): Promise<TokenSet>
  identity(accessToken: string): Promise<MailIdentity>
  inboxSummary(accessToken: string): Promise<InboxSummary>
  /** Best effort. Providers without a revoke endpoint leave this out. */
  revoke?(refreshToken: string): Promise<void>
}

/** The grant is gone (revoked, expired, password changed): the user must connect again. */
export class ReauthRequiredError extends Error {}

/** The user unticked a permission the app cannot work without. */
export class MissingScopeError extends Error {}

/** The provider failed or answered unexpectedly. Worth retrying later. */
export class ProviderError extends Error {}
