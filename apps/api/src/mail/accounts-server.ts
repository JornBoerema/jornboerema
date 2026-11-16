import { randomUUID } from "node:crypto"
import { getDb, type MailAccount, type MailConnection } from "@even/db"
import { createGmailProvider } from "@even/mail-core/gmail"
import { createOutlookProvider } from "@even/mail-core/outlook"
import { ReauthRequiredError, type MailProvider, type TokenSet } from "@even/mail-core/provider"
import {
  createOAuthState,
  hashState,
  openToken,
  parseTokenKey,
  sealToken,
} from "@even/mail-core/secrets"
import {
  firstFreeColor,
  type InboxSummary,
  type MailAccountView,
  type MailProviderId,
} from "@even/mail-core/types"
import { mailEmails, sendEmail } from "@even/email"
import { defer } from "../lib/defer"
import { env } from "../env"

export class MailNotConfiguredError extends Error {}
export class MailAccountNotFoundError extends Error {}
export class ConnectExpiredError extends Error {}

const STATE_TTL_MS = 10 * 60 * 1000
/** Refresh slightly early so a token cannot expire mid-request. */
const EXPIRY_MARGIN_MS = 60 * 1000

function credentials(provider: MailProviderId) {
  const prefix = provider === "gmail" ? "GOOGLE_MAIL" : "MICROSOFT_MAIL"
  const clientId = process.env[`${prefix}_CLIENT_ID`]
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]
  if (!clientId || !clientSecret) throw new MailNotConfiguredError(provider)
  return { clientId, clientSecret }
}

function providerFor(id: MailProviderId): MailProvider {
  return id === "gmail"
    ? createGmailProvider(credentials(id))
    : createOutlookProvider(credentials(id))
}

function tokenKey() {
  const hex = process.env.MAIL_TOKEN_KEY
  if (!hex) throw new MailNotConfiguredError("MAIL_TOKEN_KEY")
  return parseTokenKey(hex)
}

const redirectUri = (provider: MailProviderId) => `${env.apiUrl}/api/mail/callback/${provider}`
const stateContext = (userId: string, provider: MailProviderId) => `state:${userId}:${provider}`
const tokenContext = (
  account: Pick<MailAccount, "sealedFor" | "provider" | "providerAccountId">,
  kind: "access" | "refresh"
) => `${kind}:${account.sealedFor}:${account.provider}:${account.providerAccountId}`

/**
 * Who is looking at mail, and within which organization. A mailbox shows for
 * them only when they connected it in that organization.
 */
export type MailViewer = { userId: string; organizationId: string }

const connectionOf = (viewer: MailViewer) => ({ userId: viewer.userId, organizationId: viewer.organizationId })

function toView({ account, ...connection }: MailConnection & { account: MailAccount }): MailAccountView {
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    color: connection.color,
    signatures: { newId: connection.signatureNewId, replyId: connection.signatureReplyId },
    createdAt: connection.createdAt.toISOString(),
  }
}

export async function listAccounts(viewer: MailViewer): Promise<MailAccountView[]> {
  const connections = await getDb().mailConnection.findMany({
    where: connectionOf(viewer),
    include: { account: true },
    orderBy: { createdAt: "asc" },
  })
  return connections.map(toView)
}

/** The mailboxes the viewer sees, optionally only the active ones. */
export async function visibleAccounts(viewer: MailViewer, options?: { active?: boolean }) {
  const connections = await getDb().mailConnection.findMany({
    where: { ...connectionOf(viewer), ...(options?.active && { account: { status: "active" } }) },
    include: { account: true },
    orderBy: { createdAt: "asc" },
  })
  return connections.map((connection) => connection.account)
}

/** The ids of the mailboxes the viewer sees, for filtering what is stored about them. */
export async function visibleAccountIds(viewer: MailViewer) {
  const connections = await getDb().mailConnection.findMany({
    where: connectionOf(viewer),
    select: { accountId: true },
  })
  return connections.map((connection) => connection.accountId)
}

/** Everyone who has a mailbox in their list, in any organization: who hears that it changed. */
export async function connectedUsers(accountId: string) {
  const rows = await getDb().mailConnection.findMany({
    where: { accountId },
    distinct: ["userId"],
    select: { userId: true },
  })
  return rows.map((row) => row.userId)
}

/**
 * Where a connect flow may send the browser back to, besides the mail app.
 * "plan" is Even plannen, which also asks for the mailbox's calendars.
 */
export type ConnectReturn = "welcome" | "plan"

const isConnectReturn = (value: unknown): value is ConnectReturn => value === "welcome" || value === "plan"

/** Starts a connect flow and returns the provider URL to send the browser to. */
export async function startConnect(viewer: MailViewer, providerId: MailProviderId, returnTo?: ConnectReturn) {
  const { userId } = viewer
  const provider = providerFor(providerId)
  const key = tokenKey()
  const { state, codeVerifier, codeChallenge } = createOAuthState()
  const db = getDb()
  await db.mailOauthState.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  await db.mailOauthState.create({
    data: {
      id: hashState(state),
      userId,
      organizationId: viewer.organizationId,
      provider: providerId,
      codeVerifier: sealToken(codeVerifier, key, stateContext(userId, providerId)),
      returnTo: returnTo ?? null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  })
  return provider.authorizationUrl({
    state,
    codeChallenge,
    redirectUri: redirectUri(providerId),
    calendar: returnTo === "plan",
  })
}

/** Where the browser goes back to for a connect flow under way; read before it is finished. */
export async function connectReturn(state: string): Promise<ConnectReturn | null> {
  const pending = await getDb().mailOauthState.findUnique({ where: { id: hashState(state) }, select: { returnTo: true } })
  return isConnectReturn(pending?.returnTo) ? pending.returnTo : null
}

/** The link an organization's admin opens to approve Even mailen for everyone in it. */
export function outlookAdminConsentUrl() {
  return providerFor("outlook").adminConsentUrl?.({ redirectUri: redirectUri("outlook") }) ?? null
}

/**
 * Finishes a connect flow. The state only works once, for the user who started it.
 * A mailbox already connected elsewhere (another account or organization) is not
 * made again: this connection joins it, its synced mail and its sync.
 * `personalOrganization` is for flows started before organizations had mail.
 */
export async function finishConnect(
  userId: string,
  providerId: MailProviderId,
  state: string,
  code: string,
  personalOrganization: () => Promise<string>
) {
  const provider = providerFor(providerId)
  const key = tokenKey()
  const db = getDb()
  const id = hashState(state)
  const pending = await db.mailOauthState.findFirst({
    where: { id, userId, provider: providerId, expiresAt: { gt: new Date() } },
  })
  if (!pending) throw new ConnectExpiredError()
  const { count } = await db.mailOauthState.deleteMany({ where: { id } })
  if (count !== 1) throw new ConnectExpiredError()

  const tokens = await provider.exchangeCode({
    code,
    codeVerifier: openToken(pending.codeVerifier, key, stateContext(userId, providerId)),
    redirectUri: redirectUri(providerId),
    calendar: pending.returnTo === "plan",
  })
  const identity = await provider.identity(tokens.accessToken)
  const organizationId = pending.organizationId ?? (await personalOrganization())
  const member = await db.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true },
  })
  if (!member) throw new ConnectExpiredError()

  const where = { provider: providerId, providerAccountId: identity.providerAccountId }
  const existing = await db.mailAccount.findUnique({ where: { provider_providerAccountId: where } })
  // Tokens stay sealed for whoever connected the mailbox first.
  const sealing = { ...where, sealedFor: existing?.sealedFor ?? userId }
  const refreshToken = tokens.refreshToken
    ? sealToken(tokens.refreshToken, key, tokenContext(sealing, "refresh"))
    : existing?.refreshToken
  if (!refreshToken) throw new Error("Provider returned no refresh token")

  const fields = {
    email: identity.email,
    displayName: identity.displayName,
    accessToken: sealToken(tokens.accessToken, key, tokenContext(sealing, "access")),
    refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
    scope: tokens.scope,
    status: "active" as const,
  }
  const account = await db.mailAccount.upsert({
    where: { provider_providerAccountId: where },
    create: { id: randomUUID(), ...sealing, ...fields },
    update: fields,
  })
  const others = await db.mailConnection.findMany({ where: { userId, organizationId }, select: { accountId: true, color: true } })
  if (!others.some((connection) => connection.accountId === account.id))
    await db.mailConnection.upsert({
      where: { accountId_userId_organizationId: { accountId: account.id, userId, organizationId } },
      create: {
        id: randomUUID(),
        accountId: account.id,
        userId,
        organizationId,
        color: firstFreeColor(others.map((connection) => connection.color)),
      },
      update: {},
    })
  return { account, organizationId, alreadySynced: Boolean(existing?.syncCursor) }
}

async function storeRefreshed(account: MailAccount, tokens: TokenSet, key: Buffer) {
  const data = {
    accessToken: sealToken(tokens.accessToken, key, tokenContext(account, "access")),
    accessTokenExpiresAt: tokens.expiresAt,
    // Microsoft rotates refresh tokens; Google keeps the existing one valid.
    ...(tokens.refreshToken && {
      refreshToken: sealToken(tokens.refreshToken, key, tokenContext(account, "refresh")),
    }),
  }
  await getDb().mailAccount.update({ where: { id: account.id }, data })
  return data
}

/** Refreshes under way, per account: calls side by side share one instead of each refreshing. */
const refreshing = new Map<string, Promise<{ accessToken: string; stored: Partial<MailAccount> }>>()

async function validAccessToken(account: MailAccount, provider: MailProvider, key: Buffer) {
  if (account.accessTokenExpiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS)
    return openToken(account.accessToken, key, tokenContext(account, "access"))
  let pending = refreshing.get(account.id)
  if (!pending) {
    pending = (async () => {
      const tokens = await provider.refresh(
        openToken(account.refreshToken, key, tokenContext(account, "refresh")),
        account.scope
      )
      return { accessToken: tokens.accessToken, stored: await storeRefreshed(account, tokens, key) }
    })().finally(() => refreshing.delete(account.id))
    refreshing.set(account.id, pending)
  }
  const { accessToken, stored } = await pending
  // The caller may use this account again: it then has the new token, not the spent one.
  Object.assign(account, stored)
  return accessToken
}

/**
 * Runs a provider call with a valid token. A lost grant flips the account to
 * reauth_required so every client can offer "connect again".
 */
export async function withAccessToken<T>(
  account: MailAccount,
  call: (provider: MailProvider, accessToken: string) => Promise<T>
) {
  if (account.status === "reauth_required") throw new ReauthRequiredError("Already marked")
  const provider = providerFor(account.provider)
  try {
    return await call(provider, await validAccessToken(account, provider, tokenKey()))
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      const { count } = await getDb().mailAccount.updateMany({
        where: { id: account.id, status: "active" },
        data: { status: "reauth_required" },
      })
      // Only the call that flipped it writes: mail stops arriving, and nobody may be looking.
      if (count === 1) defer(() => tellOwnerToReconnect(account))
    }
    throw error
  }
}

async function tellOwnerToReconnect(account: MailAccount) {
  const owners = await getDb().user.findMany({ where: { id: { in: await connectedUsers(account.id) } }, select: { email: true } })
  for (const owner of owners)
    await sendEmail(mailEmails.reconnect({ to: owner.email, mailbox: account.email, url: `${env.mailWebUrl}/?settings=mailboxes` }))
}

/** A mailbox the viewer has in their list in this organization. */
export async function ownedAccount(viewer: MailViewer, id: string) {
  const connection = await getDb().mailConnection.findFirst({
    where: { accountId: id, ...connectionOf(viewer) },
    include: { account: true },
  })
  if (!connection) throw new MailAccountNotFoundError()
  return connection.account
}

export class MailSignatureNotFoundError extends Error {}

export type AccountSettings = {
  color?: number
  signatureNewId?: string | null
  signatureReplyId?: string | null
}

export async function updateAccountSettings(viewer: MailViewer, id: string, settings: AccountSettings) {
  const { userId } = viewer
  const account = await ownedAccount(viewer, id)
  const db = getDb()
  const chosen = [settings.signatureNewId, settings.signatureReplyId].filter((value) => typeof value === "string")
  // A mailbox may only point at its owner's signatures.
  if (chosen.length > 0) {
    const owned = await db.mailSignature.count({ where: { userId, id: { in: chosen } } })
    if (owned !== new Set(chosen).size) throw new MailSignatureNotFoundError()
  }
  await db.mailConnection.updateMany({ where: { accountId: account.id, ...connectionOf(viewer) }, data: settings })
}

export async function readInboxSummary(viewer: MailViewer, id: string): Promise<InboxSummary> {
  const account = await ownedAccount(viewer, id)
  return withAccessToken(account, (provider, token) => provider.inboxSummary(token))
}

/**
 * Takes the mailbox out of the viewer's list here. Only when nobody else has it,
 * in any account or organization, does the mailbox itself go: its synced mail at
 * once, and the grant at the provider afterwards.
 */
export async function disconnectAccount(viewer: MailViewer, id: string) {
  const account = await ownedAccount(viewer, id)
  const db = getDb()
  await db.mailConnection.deleteMany({ where: { accountId: account.id, ...connectionOf(viewer) } })
  const { count } = await db.mailAccount.deleteMany({ where: { id: account.id, connections: { none: {} } } })
  if (count === 1) defer(() => letGo(account))
}

/**
 * Mailboxes left without anyone, after an account or organization was deleted
 * (their connections go with it): removed, and the grant revoked at the provider.
 */
export async function dropUnconnectedMailboxes() {
  const db = getDb()
  const orphans = await db.mailAccount.findMany({ where: { connections: { none: {} } } })
  for (const account of orphans) {
    const { count } = await db.mailAccount.deleteMany({ where: { id: account.id, connections: { none: {} } } })
    if (count === 1) await letGo(account).catch((error) => console.error("Letting go of a mailbox failed", error))
  }
  return orphans.length
}

async function letGo(account: MailAccount) {
  const provider = providerFor(account.provider)
  const refreshToken = openToken(account.refreshToken, tokenKey(), tokenContext(account, "refresh"))
  if (provider.unwatch && account.watchId) {
    const { accessToken } = await provider.refresh(refreshToken)
    await provider.unwatch(accessToken, account.watchId)
  }
  await provider.revoke?.(refreshToken)
}
