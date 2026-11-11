// Moneybird's API: OAuth, administrations, and handing it a document.
// https://developer.moneybird.com/authentication/
// Errors carry status codes only, never token material.

import type { MoneybirdAdministration } from "@evido/mail-core/connections"

const AUTHORIZE_URL = "https://moneybird.com/oauth/authorize"
const TOKEN_URL = "https://moneybird.com/oauth/token"
const REVOKE_URL = "https://moneybird.com/oauth/revoke"
const API_URL = "https://moneybird.com/api/v2"
/** Reading administrations needs no more; documents are where mail goes. */
export const MONEYBIRD_SCOPE = "documents"
const TIMEOUT_MS = 10_000
const UPLOAD_TIMEOUT_MS = 30_000

export class MoneybirdNotConfiguredError extends Error {}
/** The token was refused: the user revoked it, or it expired. */
export class MoneybirdReauthError extends Error {}
export class MoneybirdError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

export type MoneybirdTokens = {
  accessToken: string
  refreshToken: string | null
  /** Moneybird's tokens don't expire for now; null then. */
  expiresAt: Date | null
  scope: string
}

export function moneybirdCredentials() {
  const clientId = process.env.MONEYBIRD_CLIENT_ID
  const clientSecret = process.env.MONEYBIRD_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new MoneybirdNotConfiguredError()
  return { clientId, clientSecret }
}

export const moneybirdConfigured = () => !!process.env.MONEYBIRD_CLIENT_ID && !!process.env.MONEYBIRD_CLIENT_SECRET

export function authorizationUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: moneybirdCredentials().clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: MONEYBIRD_SCOPE,
    state,
  }).toString()
  return url.toString()
}

async function tokenRequest(params: Record<string, string>): Promise<MoneybirdTokens> {
  const { clientId, clientSecret } = moneybirdCredentials()
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
  }
  if (!response.ok) {
    if (body.error === "invalid_grant") throw new MoneybirdReauthError("invalid_grant")
    throw new MoneybirdError(`Moneybird token endpoint answered ${response.status} ${body.error ?? ""}`.trim(), response.status)
  }
  if (!body.access_token) throw new MoneybirdError("Moneybird token response is incomplete")
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
    scope: body.scope ?? MONEYBIRD_SCOPE,
  }
}

export const exchangeCode = (code: string, redirectUri: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri })

export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken })

/** Revoking one token ends the other too. Best effort: the connection is gone here either way. */
export async function revoke(token: string) {
  const { clientId, clientSecret } = moneybirdCredentials()
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined)
}

async function call<T>(token: string, path: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(timeout),
  })
  if (response.status === 401) throw new MoneybirdReauthError("Access token rejected")
  if (!response.ok) throw new MoneybirdError(`Moneybird answered ${response.status} on ${path.split("/").slice(0, 3).join("/")}`, response.status)
  return (await response.json().catch(() => null)) as T
}

/** Administrations the token may use; suspended ones can't take documents. */
export async function listAdministrations(token: string): Promise<MoneybirdAdministration[]> {
  const list = await call<{ id: string | number; name: string; suspended?: boolean }[]>(token, "/administrations.json")
  return (list ?? []).filter((item) => !item.suspended).map((item) => ({ id: String(item.id), name: item.name }))
}

const adminPath = (administrationId: string) => {
  // Ids come from the client; only digits ever reach the URL.
  if (!/^\d{1,30}$/.test(administrationId)) throw new MoneybirdError("Invalid administration id", 400)
  return `/${administrationId}`
}

/**
 * Puts a file in the administration's inbox ("te verwerken"), where Moneybird
 * reads it and the user books it: a document without a type, with the file
 * attached. The API can't set the type; Moneybird and the user do that.
 */
export async function uploadToInbox(
  token: string,
  administrationId: string,
  file: { name: string; contentType: string; bytes: Uint8Array; reference: string }
) {
  const base = adminPath(administrationId)
  const document = await call<{ id: string | number }>(token, `${base}/documents/typeless_documents.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ typeless_document: { reference: file.reference.slice(0, 250) } }),
  })
  const id = String(document.id)
  const form = new FormData()
  form.append("file", new Blob([file.bytes as BlobPart], { type: file.contentType || "application/octet-stream" }), file.name)
  try {
    await call(token, `${base}/documents/typeless_documents/${id}/attachments.json`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS)
  } catch (error) {
    // No empty document left behind in their inbox.
    await call(token, `${base}/documents/typeless_documents/${id}.json`, { method: "DELETE" }).catch(() => undefined)
    throw error
  }
  return id
}

/** Where the user finds it: the administration in Moneybird. */
export const administrationUrl = (administrationId: string) => `https://moneybird.com/${administrationId}`
