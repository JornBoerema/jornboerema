import { isRateLimited, ProviderError, ReauthRequiredError, type TokenSet } from "./provider"

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
  const retryAfter = Number(response.headers.get("retry-after"))
  throw new ProviderError(`${new URL(url).host} answered ${response.status} ${code ?? ""}`.trim(), {
    status: response.status,
    code,
    ...(retryAfter > 0 && { retryAfterMs: retryAfter * 1000 }),
  })
}

/** Waits between tries when the provider says to slow down. Longer waits are not worth it here. */
const RETRY_DELAYS_MS = [1000, 2000, 4000]
const MAX_RETRY_WAIT_MS = 8000

/** The provider had a passing fault (Graph answers 503 now and then); asking again usually works. */
const isServerHiccup = (error: unknown) =>
  error instanceof ProviderError && [500, 502, 503, 504].includes(error.status ?? 0)

/**
 * Tries again when the provider refuses for being busy. A refused request was not
 * carried out, so this is safe for sends too. Reads and deletes, which can be
 * repeated safely, also try again after a passing server fault (`idempotent`).
 * Other failures pass straight through.
 */
export async function withRateLimitRetry<T>(request: () => Promise<T>, { idempotent = false } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request()
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt]
      const retry = isRateLimited(error) || (idempotent && isServerHiccup(error))
      if (!retry || delay === undefined) throw error
      const asked = (error as ProviderError).retryAfterMs ?? 0
      if (asked > MAX_RETRY_WAIT_MS) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.max(delay, asked)))
    }
  }
}

export function getJson<T>(
  url: string,
  accessToken: string,
  headers?: Record<string, string>,
  timeoutMs = TIMEOUT_MS
): Promise<T> {
  return withRateLimitRetry(async () => {
    const response = await fetch(url, {
      headers: { ...headers, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    await ensureOk(response, url)
    return (await response.json()) as T
  }, { idempotent: true })
}

/** For reading attachments, which are far larger than ordinary API answers. */
export const SLOW_READ_TIMEOUT_MS = 25_000

/**
 * Sends a change to a provider. The timeout is long because giving up on a send
 * that actually went through would invite the user to send it twice.
 */
export async function sendBody(
  method: "POST" | "PATCH" | "PUT",
  url: string,
  accessToken: string,
  contentType: string,
  body: string,
  headers?: Record<string, string>
) {
  return withRateLimitRetry(async () => {
    const response = await fetch(url, {
      method,
      headers: { ...headers, Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
      body,
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
    await ensureOk(response, url)
    return response
  })
}

export const sendJson = (
  method: "POST" | "PATCH" | "PUT",
  url: string,
  accessToken: string,
  body: unknown,
  headers?: Record<string, string>
) => sendBody(method, url, accessToken, "application/json", JSON.stringify(body), headers)

/** Deletes a provider resource. Already gone counts as done. */
export async function deleteResource(url: string, accessToken: string, headers?: Record<string, string>) {
  await withRateLimitRetry(async () => {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { ...headers, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status !== 404) await ensureOk(response, url)
  }, { idempotent: true })
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

/** Plain text as HTML. Whatever it contains can't become markup. */
export const textToHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replace(/\r?\n/g, "<br>")
