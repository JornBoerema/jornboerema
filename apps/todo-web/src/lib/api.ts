export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

/** Fetch against the Evido API with the shared session cookie. */
export function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, { cache: "no-store", ...init, credentials: "include" })
}

/** Absolute URL in this web app, for links the API puts in e-mails and redirects. */
export const webUrl = (path: string) => new URL(path, window.location.origin).toString()
