import { ProviderError, ReauthRequiredError, type TokenSet } from "./provider"

const TIMEOUT_MS = 10_000

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
}

/** POST to an OAuth token endpoint. Errors carry status codes only, never token material. */
export async function requestTokens(url: string, params: Record<string, string>): Promise<TokenSet> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok) {
    if (body.error === "invalid_grant") throw new ReauthRequiredError("invalid_grant")
    throw new ProviderError(`Token endpoint answered ${response.status} ${body.error ?? ""}`.trim())
  }
  if (!body.access_token || typeof body.expires_in !== "number")
    throw new ProviderError("Token endpoint response is incomplete")
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
    scope: body.scope ?? "",
  }
}

export async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 401) throw new ReauthRequiredError("Access token rejected")
  if (!response.ok) throw new ProviderError(`${new URL(url).host} answered ${response.status}`)
  return (await response.json()) as T
}
