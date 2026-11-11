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

/** The Evido web apps; auth pages and e-mail links default to Even doen. */
export type WebApp = "todo" | "mail"

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
      onResponse: ({ response, request }) => {
        if (!isDesktop()) return
        const token = response.headers.get("set-auth-token")
        if (token) localStorage.setItem(TOKEN_KEY, token)
        else if (response.ok && String(request.url).includes("/sign-out")) clearSessionToken()
      },
    },
    plugins: [oauthProviderClient()],
  })
}

export type EvidoAuthClient = ReturnType<typeof createEvidoAuthClient>
