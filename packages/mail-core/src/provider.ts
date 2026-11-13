import type {
  InboxSummary,
  MailAddress,
  MailDraft,
  MailDraftContent,
  MailForward,
  MailOutgoing,
  MailProviderId,
  MailReply,
  MailThreadAction,
  MailThreadMessage,
  MailDraftView,
  MailSearchHit,
} from "./types"

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

/** Where a message sits. Gmail labels are mapped onto these; custom folders aren't synced. */
export type MailMessageFolder = "inbox" | "sent" | "archive" | "spam" | "trash"

/** The list metadata kept for one message. Bodies are never part of this. */
export type MailMessageData = {
  providerMessageId: string
  threadId: string | null
  folder: MailMessageFolder
  to: MailAddress[]
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
  /** Messages that were deleted or are no longer synced. */
  removals: string[]
  /**
   * Set when the removals only mean "left this folder", as with a Graph folder
   * delta. A message that already arrived in another folder then stays.
   */
  removalFolder?: MailMessageFolder
  /** Where the next call continues. Store it together with this page's changes. */
  cursor: string
  /** True when the mailbox is caught up for now. */
  done: boolean
}

export type MailWatch = { id: string | null; expiresAt: Date }

export type WatchInput = {
  /** Where Graph posts changes. */
  webhookUrl: string
  /** Pub/Sub topic Gmail publishes to. */
  gmailTopic: string | null
  /** Echoed back in Graph notifications to prove they are genuine. */
  clientState: string
  existingId: string | null
}

export interface MailProvider {
  readonly id: MailProviderId
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string
  /**
   * Where an organization's admin approves the app for everyone in it, when
   * the organization doesn't let people approve apps themselves. Outlook only.
   */
  adminConsentUrl?(input: { redirectUri: string }): string
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>
  refresh(refreshToken: string): Promise<TokenSet>
  identity(accessToken: string): Promise<MailIdentity>
  inboxSummary(accessToken: string): Promise<InboxSummary>
  /** One step of the inbox sync. A null cursor starts a full sync from `since`. */
  syncPage(accessToken: string, input: { cursor: string | null; since: Date }): Promise<SyncPage>
  /**
   * Every message of a conversation, oldest first, without drafts. Spam and trash
   * are left out too, unless the conversation is being read from those folders.
   */
  getThread(accessToken: string, threadId: string, options?: { includeHidden?: boolean }): Promise<MailThreadMessage[]>
  /** `messageIds` are the conversation's messages currently in the inbox. */
  applyThreadAction(
    accessToken: string,
    input: { threadId: string; messageIds: string[]; action: MailThreadAction }
  ): Promise<void>
  send(accessToken: string, input: MailOutgoing & { from: MailAddress }): Promise<void>
  reply(accessToken: string, input: MailReply & { from: MailAddress; threadId: string }): Promise<void>
  /** Sends the original with its attachments to new recipients. */
  forward(accessToken: string, input: MailForward & { from: MailAddress }): Promise<void>
  /** Conversations matching `query`, best first. Drafts, spam and trash are left out. */
  search(accessToken: string, query: string): Promise<Omit<MailSearchHit, "accountId">[]>
  /** The newest drafts, at most MAX_LISTED_DRAFTS. `accountId` is filled in by the caller. */
  listDrafts(accessToken: string): Promise<Omit<MailDraftView, "accountId">[]>
  /** Includes attachment contents, so saving it again keeps them. */
  getDraft(accessToken: string, draftId: string): Promise<MailDraft>
  /**
   * Creates the draft when `draftId` is null and replaces its content otherwise.
   * Returns the id to save to next time. `attachmentsChanged` false lets Graph skip re-uploading.
   */
  saveDraft(
    accessToken: string,
    input: MailDraftContent & { from: MailAddress; draftId: string | null; attachmentsChanged: boolean }
  ): Promise<string>
  /** Sends a saved draft as it is at the provider. */
  sendDraft(accessToken: string, draftId: string): Promise<void>
  deleteDraft(accessToken: string, draftId: string): Promise<void>
  getAttachment(
    accessToken: string,
    input: { messageId: string; attachmentId: string }
  ): Promise<Uint8Array>
  /** Deletes everything in the trash for good, a page at a time. Outlook only. */
  emptyTrash?(accessToken: string): Promise<{ deleted: number; done: boolean }>
  /** Starts or renews change notifications for this mailbox. */
  watch(accessToken: string, input: WatchInput): Promise<MailWatch>
  /** Gmail needs none: revoking access ends its watch. */
  unwatch?(accessToken: string, watchId: string): Promise<void>
  /** Best effort. Providers without a revoke endpoint leave this out. */
  revoke?(refreshToken: string): Promise<void>
}

/** The provider can't do this with the access the app has. */
export class UnsupportedActionError extends Error {}

/** The grant is gone (revoked, expired, password changed): the user must connect again. */
export class ReauthRequiredError extends Error {}

/** The user unticked a permission the app cannot work without. */
export class MissingScopeError extends Error {}

/** The provider failed or answered unexpectedly. Worth retrying later. */
export class ProviderError extends Error {
  status?: number
  code?: string
  /** How long the provider asked to wait, from Retry-After. */
  retryAfterMs?: number

  constructor(message: string, details?: { status?: number; code?: string; retryAfterMs?: number }) {
    super(message)
    this.status = details?.status
    this.code = details?.code
    this.retryAfterMs = details?.retryAfterMs
  }
}

/** Temporary and expected during large syncs; the right response is to wait. */
export const isRateLimited = (error: unknown) =>
  error instanceof ProviderError &&
  (error.status === 429 || (error.status === 403 && /ratelimit/i.test(error.code ?? "")))

/** The provider no longer knows this position: the mailbox needs a full sync. */
export class SyncCursorExpiredError extends Error {}
