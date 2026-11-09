import { randomUUID } from "node:crypto"
import { getDb, type MailAccount } from "@evido/db"
import { createGmailProvider } from "@evido/mail-core/gmail"
import { createOutlookProvider } from "@evido/mail-core/outlook"
import { ReauthRequiredError, type MailProvider, type TokenSet } from "@evido/mail-core/provider"
import {
  createOAuthState,
  hashState,
  openToken,
  parseTokenKey,
  sealToken,
} from "@evido/mail-core/secrets"
import type { InboxSummary, MailAccountView, MailProviderId } from "@evido/mail-core/types"
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
  account: Pick<MailAccount, "userId" | "provider" | "providerAccountId">,
  kind: "access" | "refresh"
) => `${kind}:${account.userId}:${account.provider}:${account.providerAccountId}`

function toView(account: MailAccount): MailAccountView {
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
  }
}

export async function listAccounts(userId: string): Promise<MailAccountView[]> {
  const accounts = await getDb().mailAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  })
  return accounts.map(toView)
}

/** Starts a connect flow and returns the provider URL to send the browser to. */
export async function startConnect(userId: string, providerId: MailProviderId) {
  const provider = providerFor(providerId)
  const key = tokenKey()
  const { state, codeVerifier, codeChallenge } = createOAuthState()
  const db = getDb()
  await db.mailOauthState.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  await db.mailOauthState.create({
    data: {
      id: hashState(state),
      userId,
      provider: providerId,
      codeVerifier: sealToken(codeVerifier, key, stateContext(userId, providerId)),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  })
  return provider.authorizationUrl({
    state,
    codeChallenge,
    redirectUri: redirectUri(providerId),
  })
}

/** Finishes a connect flow. The state only works once, for the user who started it. */
export async function finishConnect(
  userId: string,
  providerId: MailProviderId,
  state: string,
  code: string
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
  })
  const identity = await provider.identity(tokens.accessToken)
  const where = {
    userId,
    provider: providerId,
    providerAccountId: identity.providerAccountId,
  }
  const existing = await db.mailAccount.findUnique({
    where: { userId_provider_providerAccountId: where },
  })
  const refreshToken = tokens.refreshToken
    ? sealToken(tokens.refreshToken, key, tokenContext(where, "refresh"))
    : existing?.refreshToken
  if (!refreshToken) throw new Error("Provider returned no refresh token")

  const fields = {
    email: identity.email,
    displayName: identity.displayName,
    accessToken: sealToken(tokens.accessToken, key, tokenContext(where, "access")),
    refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
    scope: tokens.scope,
    status: "active" as const,
  }
  await db.mailAccount.upsert({
    where: { userId_provider_providerAccountId: where },
    create: { id: randomUUID(), ...where, ...fields },
    update: fields,
  })
}

async function storeRefreshed(account: MailAccount, tokens: TokenSet, key: Buffer) {
  await getDb().mailAccount.update({
    where: { id: account.id },
    data: {
      accessToken: sealToken(tokens.accessToken, key, tokenContext(account, "access")),
      accessTokenExpiresAt: tokens.expiresAt,
      // Microsoft rotates refresh tokens; Google keeps the existing one valid.
      ...(tokens.refreshToken && {
        refreshToken: sealToken(tokens.refreshToken, key, tokenContext(account, "refresh")),
      }),
    },
  })
}

async function validAccessToken(account: MailAccount, provider: MailProvider, key: Buffer) {
  if (account.accessTokenExpiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS)
    return openToken(account.accessToken, key, tokenContext(account, "access"))
  const tokens = await provider.refresh(
    openToken(account.refreshToken, key, tokenContext(account, "refresh"))
  )
  await storeRefreshed(account, tokens, key)
  return tokens.accessToken
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
    if (error instanceof ReauthRequiredError)
      await getDb().mailAccount.update({
        where: { id: account.id },
        data: { status: "reauth_required" },
      })
    throw error
  }
}

export async function ownedAccount(userId: string, id: string) {
  const account = await getDb().mailAccount.findFirst({ where: { id, userId } })
  if (!account) throw new MailAccountNotFoundError()
  return account
}

export async function readInboxSummary(userId: string, id: string): Promise<InboxSummary> {
  const account = await ownedAccount(userId, id)
  return withAccessToken(account, (provider, token) => provider.inboxSummary(token))
}

/** Removes the mailbox here at once; revoking at the provider happens afterwards. */
export async function disconnectAccount(userId: string, id: string) {
  const account = await ownedAccount(userId, id)
  await getDb().mailAccount.delete({ where: { id: account.id } })
  defer(async () => {
    const provider = providerFor(account.provider)
    await provider.revoke?.(
      openToken(account.refreshToken, tokenKey(), tokenContext(account, "refresh"))
    )
  })
}
