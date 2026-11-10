import { currentLanguage } from "@evido/i18n/react"

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** JSON request against the Evido API with the shared session cookie. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Accept-Language", currentLanguage())
  if (init?.json !== undefined) headers.set("Content-Type", "application/json")
  const response = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
    ...(init?.json !== undefined && { body: JSON.stringify(init.json) }),
    headers,
    credentials: "include",
  })
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new ApiError(body?.error ?? response.statusText, response.status)
  return body as T
}
