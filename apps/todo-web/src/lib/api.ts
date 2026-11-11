import { authHeaders } from "@evido/auth/client"
import { currentLanguage } from "@evido/i18n/react"

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

/** Fetch against the Evido API with the shared session cookie. */
export function apiFetch(path: string, init?: RequestInit) {
  // The API answers errors (and sends e-mails) in the user's language.
  const headers = new Headers(init?.headers)
  headers.set("Accept-Language", currentLanguage())
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value)
  return fetch(`${API_URL}${path}`, { cache: "no-store", ...init, headers, credentials: "include" })
}

/** Absolute URL in the web app, for links the API puts in e-mails and redirects. */
export { webUrl } from "@evido/auth/client"
