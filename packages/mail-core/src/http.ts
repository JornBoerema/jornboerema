import { ProviderError, ReauthRequiredError, type TokenSet } from "./provider"

const TIMEOUT_MS = 10_000
const WRITE_TIMEOUT_MS = 25_000

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

async function ensureOk(response: Response, url: string) {
  if (response.status === 401) throw new ReauthRequiredError("Access token rejected")
  if (response.ok) return
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: unknown; errors?: { reason?: unknown }[] }
  }
  // Graph puts a name in `code`; Google puts a number there and the name in `reason`.
  const code = [body.error?.code, body.error?.errors?.[0]?.reason].find(
    (value) => typeof value === "string"
  ) as string | undefined
  throw new ProviderError(`${new URL(url).host} answered ${response.status} ${code ?? ""}`.trim(), {
    status: response.status,
    code,
  })
}

export async function getJson<T>(
  url: string,
  accessToken: string,
  headers?: Record<string, string>
): Promise<T> {
  const response = await fetch(url, {
    headers: { ...headers, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  await ensureOk(response, url)
  return (await response.json()) as T
}

/**
 * Sends a change to a provider. The timeout is long because giving up on a send
 * that actually went through would invite the user to send it twice.
 */
export async function sendJson(
  method: "POST" | "PATCH",
  url: string,
  accessToken: string,
  body: unknown,
  headers?: Record<string, string>
) {
  const response = await fetch(url, {
    method,
    headers: { ...headers, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  await ensureOk(response, url)
}

/** Runs `work` over `items` a few at a time, keeping providers within their rate limits. */
export async function mapInChunks<T, R>(items: T[], size: number, work: (item: T) => Promise<R>) {
  const results: R[] = []
  for (let start = 0; start < items.length; start += size)
    results.push(...(await Promise.all(items.slice(start, start + size).map(work))))
  return results
}

/** Postgres text columns reject NUL, and mail headers can contain anything. */
export const cleanText = (value: string) => value.replaceAll("\0", "")
