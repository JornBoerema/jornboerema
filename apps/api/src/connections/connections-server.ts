import { randomBytes, randomUUID } from "node:crypto"
import { getDb, type Connection } from "@evido/db"
import { hashState, openToken, parseTokenKey, sealToken } from "@evido/mail-core/secrets"
import type { ConnectionsView, ConnectionView, MoneybirdAdministration } from "@evido/mail-core/connections"
import { defer } from "../lib/defer"
import { env } from "../env"
import {
  authorizationUrl,
  exchangeCode,
  listAdministrations,
  moneybirdConfigured,
  MoneybirdNotConfiguredError,
  MoneybirdReauthError,
  refreshTokens,
  revoke,
  type MoneybirdTokens,
} from "./moneybird"

export class ConnectionExpiredError extends Error {}
export class ConnectionNotFoundError extends Error {}
export class AdministrationNotFoundError extends Error {}

const PROVIDER = "moneybird"
const STATE_TTL_MS = 10 * 60 * 1000
const EXPIRY_MARGIN_MS = 60 * 1000

function tokenKey() {
  const hex = process.env.MAIL_TOKEN_KEY
  if (!hex) throw new MoneybirdNotConfiguredError("MAIL_TOKEN_KEY")
  return parseTokenKey(hex)
}

export const moneybirdRedirectUri = () => `${env.apiUrl}/api/connections/moneybird/callback`
const tokenContext = (userId: string, kind: "access" | "refresh") => `connection:${kind}:${userId}:${PROVIDER}`

/** Starts connecting Moneybird and returns where to send the browser. */
export async function startMoneybirdConnect(userId: string) {
  if (!moneybirdConfigured()) throw new MoneybirdNotConfiguredError()
  const state = randomBytes(32).toString("base64url")
  const db = getDb()
  await db.connectionOauthState.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  await db.connectionOauthState.create({
    data: { id: hashState(state), userId, provider: PROVIDER, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
  })
  return authorizationUrl({ state, redirectUri: moneybirdRedirectUri() })
}

function sealed(userId: string, tokens: MoneybirdTokens, key: Buffer) {
  return {
    accessToken: sealToken(tokens.accessToken, key, tokenContext(userId, "access")),
    refreshToken: tokens.refreshToken ? sealToken(tokens.refreshToken, key, tokenContext(userId, "refresh")) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    scope: tokens.scope,
    status: "active",
  }
}

/** Finishes connecting. The state works once, for the user who started it. */
export async function finishMoneybirdConnect(userId: string, state: string, code: string) {
  const db = getDb()
  const id = hashState(state)
  const { count } = await db.connectionOauthState.deleteMany({
    where: { id, userId, provider: PROVIDER, expiresAt: { gt: new Date() } },
  })
  if (count !== 1) throw new ConnectionExpiredError()

  const tokens = await exchangeCode(code, moneybirdRedirectUri())
  const administrations = await listAdministrations(tokens.accessToken)
  // One administration: that's where mail goes. More: asked the first time, then remembered per sender.
  const only = administrations.length === 1 ? administrations[0] : null
  const fields = sealed(userId, tokens, tokenKey())
  const existing = await db.connection.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } })
  const keepDefault = existing?.defaultTargetId && administrations.some((item) => item.id === existing.defaultTargetId)
  const target = keepDefault ? {} : { defaultTargetId: only?.id ?? null, defaultTargetName: only?.name ?? null }
  await db.connection.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { id: randomUUID(), userId, provider: PROVIDER, ...fields, ...target },
    update: { ...fields, ...target },
  })
}

export async function moneybirdConnection(userId: string) {
  const connection = await getDb().connection.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } })
  if (!connection) throw new ConnectionNotFoundError()
  return connection
}

/** Refreshes under way per connection, so calls side by side share one. */
const refreshing = new Map<string, Promise<string>>()

async function validToken(connection: Connection, key: Buffer) {
  const expires = connection.accessTokenExpiresAt
  if (!expires || expires.getTime() - Date.now() > EXPIRY_MARGIN_MS || !connection.refreshToken)
    return openToken(connection.accessToken, key, tokenContext(connection.userId, "access"))
  let pending = refreshing.get(connection.id)
  if (!pending) {
    pending = (async () => {
      const tokens = await refreshTokens(openToken(connection.refreshToken!, key, tokenContext(connection.userId, "refresh")))
      const data = sealed(connection.userId, tokens, key)
      await getDb().connection.update({
        where: { id: connection.id },
        // Keep the old refresh token when Moneybird doesn't hand out a new one.
        data: { ...data, refreshToken: data.refreshToken ?? connection.refreshToken },
      })
      return tokens.accessToken
    })().finally(() => refreshing.delete(connection.id))
    refreshing.set(connection.id, pending)
  }
  return pending
}

/** Runs a Moneybird call with a valid token; a refused token marks the connection to connect again. */
export async function withMoneybird<T>(connection: Connection, run: (token: string) => Promise<T>) {
  if (connection.status !== "active") throw new MoneybirdReauthError("Already marked")
  try {
    return await run(await validToken(connection, tokenKey()))
  } catch (error) {
    if (error instanceof MoneybirdReauthError)
      await getDb().connection.update({ where: { id: connection.id }, data: { status: "reauth_required" } })
    throw error
  }
}

/** Administrations read live, or none when Moneybird can't be reached right now. */
export async function administrationsOf(connection: Connection): Promise<MoneybirdAdministration[]> {
  if (connection.status !== "active") return []
  try {
    return await withMoneybird(connection, listAdministrations)
  } catch (error) {
    console.error("Moneybird administrations failed", error instanceof Error ? error.message : "unknown")
    return []
  }
}

async function toView(connection: Connection): Promise<ConnectionView> {
  const administrations = await administrationsOf(connection)
  return {
    provider: PROVIDER,
    status: connection.status === "active" ? "active" : "reauth_required",
    defaultTarget:
      connection.defaultTargetId && connection.defaultTargetName
        ? { id: connection.defaultTargetId, name: connection.defaultTargetName }
        : null,
    administrations,
    createdAt: connection.createdAt.toISOString(),
  }
}

export async function listConnections(userId: string): Promise<ConnectionsView> {
  const rows = await getDb().connection.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })
  return {
    connections: await Promise.all(rows.map(toView)),
    available: moneybirdConfigured() ? [PROVIDER] : [],
  }
}

/** The administration mail goes to unless another is picked; null asks each time. */
export async function setDefaultAdministration(userId: string, administrationId: string | null) {
  const connection = await moneybirdConnection(userId)
  if (administrationId === null) {
    await getDb().connection.update({ where: { id: connection.id }, data: { defaultTargetId: null, defaultTargetName: null } })
    return
  }
  const match = (await withMoneybird(connection, listAdministrations)).find((item) => item.id === administrationId)
  if (!match) throw new AdministrationNotFoundError()
  await getDb().connection.update({
    where: { id: connection.id },
    data: { defaultTargetId: match.id, defaultTargetName: match.name },
  })
}

/** Gone here at once; Moneybird hears about it afterwards. */
export async function disconnectMoneybird(userId: string) {
  const connection = await moneybirdConnection(userId)
  await getDb().connection.delete({ where: { id: connection.id } })
  defer(() => revoke(openToken(connection.accessToken, tokenKey(), tokenContext(userId, "access"))))
}
