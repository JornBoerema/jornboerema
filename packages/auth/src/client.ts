import { createAuthClient } from "better-auth/react"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"

const TOKEN_KEY = "evido.session-token"

/** True inside the Even desktop app (Tauri), where the API can't keep a cookie. */
export const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

function storedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Keeps the session token the desktop app got from signing in through the browser. */
export function setSessionToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

/** Forgets the desktop session token, e.g. after signing out. */
export function clearSessionToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/**
 * Headers that carry the session to the API. On the web the shared cookie does
 * that; the desktop app sends the token it got at sign-in instead.
 */
export function authHeaders(): Record<string, string> {
  const token = isDesktop() ? storedToken() : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** The Evido web apps, and the account site that holds every sign-in screen. */
export type WebApp = "todo" | "mail" | "auth"

let webOrigins: Partial<Record<WebApp, string>> = {}

/**
 * The desktop app has no web address of its own, so links in e-mails
 * (verification, password reset) and hand-offs to the browser point at the
 * web apps set here.
 */
export function setWebOrigins(origins: Partial<Record<WebApp, string>>) {
  webOrigins = Object.fromEntries(
    Object.entries(origins).map(([app, origin]) => [app, origin.replace(/\/$/, "")])
  )
}

/** Absolute URL in the web app, for links the API puts in e-mails and redirects. */
export const webUrl = (path: string, app: WebApp = "todo") =>
  new URL(path, webOrigins[app] ?? window.location.origin).toString()

const isLocal = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1"

/** In development the account site runs on this port. */
const LOCAL_AUTH_PORT = 3005

/**
 * The account site: auth.<domain> next to this app (todo.jornboerema.nl and
 * jornboerema.nl both use auth.jornboerema.nl), or set with setWebOrigins.
 */
export function authOrigin() {
  if (webOrigins.auth) return webOrigins.auth
  const { protocol, hostname } = window.location
  if (isLocal(hostname)) return `http://localhost:${LOCAL_AUTH_PORT}`
  const labels = hostname.split(".")
  const domain = labels.length > 2 ? labels.slice(1).join(".") : hostname
  return `${protocol}//auth.${domain}`
}

/** A page on the account site. */
export const authUrl = (path: string, params: Record<string, string> = {}) => {
  const url = new URL(path, authOrigin())
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url.toString()
}

/** Sends the browser to the account site to sign in, and back here afterwards. */
export function goToSignIn(options: { returnTo?: string; mode?: "login" | "signup"; error?: string | null } = {}) {
  const params: Record<string, string> = { returnTo: options.returnTo ?? window.location.href }
  if (options.error) params.error = options.error
  window.location.replace(authUrl(options.mode === "signup" ? "/signup" : "/login", params))
}

/**
 * Where the account site may send someone after signing in: its own pages, and
 * the apps on the same domain (any localhost port while developing). Anything
 * else would make it an open redirect.
 */
export function isAllowedReturn(url: URL, here: Location = window.location) {
  if (url.origin === here.origin) return true
  if (isLocal(here.hostname)) return isLocal(url.hostname)
  if (url.protocol !== "https:") return false
  const domain = here.hostname.replace(/^auth\./, "")
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`)
}

/**
 * Signing in with a callbackURL (for the verification e-mail's link) answers
 * "redirect there", and the client follows it. That URL is the web app, so the
 * desktop app would open it in the browser; it stays where it is instead.
 */
async function keepInApp(response: Response, url: string) {
  if (!response.ok || !/\/sign-(in|up)\//.test(url)) return
  const body = (await response.clone().json().catch(() => null)) as { redirect?: boolean } | null
  if (!body?.redirect) return
  return new Response(JSON.stringify({ ...body, redirect: false }), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Browser auth client for every Evido React app; `baseURL` is the API origin.
 * `language` is sent as Accept-Language so auth e-mails use the user's language.
 */
export function createEvidoAuthClient(
  baseURL: string,
  options: { language?: () => string } = {}
) {
  return createAuthClient({
    baseURL,
    fetchOptions: {
      credentials: "include",
      onRequest: (context) => {
        if (options.language) context.headers.set("Accept-Language", options.language())
        for (const [name, value] of Object.entries(authHeaders())) context.headers.set(name, value)
      },
      onResponse: async ({ response, request }) => {
        if (!isDesktop()) return
        const token = response.headers.get("set-auth-token")
        if (token) localStorage.setItem(TOKEN_KEY, token)
        else if (response.ok && String(request.url).includes("/sign-out")) clearSessionToken()
        return keepInApp(response, String(request.url))
      },
    },
    plugins: [oauthProviderClient()],
  })
}

export type EvidoAuthClient = ReturnType<typeof createEvidoAuthClient>
