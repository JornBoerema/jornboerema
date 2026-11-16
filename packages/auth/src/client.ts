import { createAuthClient } from "better-auth/react"
import { organizationClient, twoFactorClient } from "better-auth/client/plugins"
import { passkeyClient } from "@better-auth/passkey/client"

/** The sign-in providers on the sign-in page, besides e-mail and password. */
export type SocialProvider = "google" | "microsoft" | "apple"

const TOKEN_KEY = "even.session-token"

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

/** The apps in the Even web app, each under its own path: app.jornboerema.nl/mail, /todo, /notes, /plan. */
export type WebApp = "todo" | "mail" | "notes" | "plan"

/** Where the Even web app runs while developing (apps/app-web). */
const LOCAL_WEB_ORIGIN = "http://localhost:3007"

let webOriginSet: string | null = null

/**
 * The desktop app has no web address of its own, so links in e-mails
 * (verification, password reset) and hand-offs to the browser point at the
 * Even web app set here.
 */
export function setWebOrigin(origin: string) {
  webOriginSet = origin.replace(/\/$/, "")
}

const isLocal = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1"

/** jornboerema.nl for app.jornboerema.nl, www.jornboerema.nl and jornboerema.nl alike. */
const siteDomain = (hostname: string) => hostname.replace(/^(app|www)\./, "")

/**
 * The Even web app, which holds the apps, signing in and the account pages:
 * app.<domain>. From the web app itself that is this origin; the website
 * (jornboerema.nl) finds it next door; the desktop app sets it with setWebOrigin.
 */
export function webOrigin() {
  if (webOriginSet) return webOriginSet
  const { protocol, hostname, origin } = window.location
  if (isLocal(hostname)) return LOCAL_WEB_ORIGIN
  if (hostname.startsWith("app.")) return origin
  return `${protocol}//app.${siteDomain(hostname)}`
}

/** A page in the Even web app, for links the API puts in e-mails and redirects. */
export const webUrl = (path: string) => new URL(path, webOrigin()).toString()

/** A place in one of the apps: appUrl("mail", "/?settings=mailboxes") is …/mail/?settings=mailboxes. */
export const appUrl = (app: WebApp, path = "/") => `${webOrigin()}/${app}${path}`

/** A sign-in or account page (/login, /signup, /account, …), with its query. */
export const authUrl = (path: string, params: Record<string, string> = {}) => {
  const url = new URL(path, webOrigin())
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url.toString()
}

/** Sends the browser to sign in, and back here afterwards. */
export function goToSignIn(options: { returnTo?: string; mode?: "login" | "signup"; error?: string | null } = {}) {
  const params: Record<string, string> = { returnTo: options.returnTo ?? window.location.href }
  if (options.error) params.error = options.error
  window.location.replace(authUrl(options.mode === "signup" ? "/signup" : "/login", params))
}

/**
 * Where signing in may send someone afterwards: the web app's own pages and
 * the website on the same domain (any localhost port while developing).
 * Anything else would make it an open redirect.
 */
export function isAllowedReturn(url: URL, here: Location = window.location) {
  if (url.origin === here.origin) return true
  if (isLocal(here.hostname)) return isLocal(url.hostname)
  if (url.protocol !== "https:") return false
  const domain = siteDomain(here.hostname)
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
 * Browser auth client for every Even React app; `baseURL` is the API origin.
 * `language` is sent as Accept-Language so auth e-mails use the user's language.
 */
export function createEvenAuthClient(
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
    // The sign-in form asks for the second step itself when sign-in answers twoFactorRedirect.
    plugins: [organizationClient(), twoFactorClient(), passkeyClient()],
  })
}

export type EvenAuthClient = ReturnType<typeof createEvenAuthClient>
