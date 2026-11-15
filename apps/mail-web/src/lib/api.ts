import { authHeaders } from "@even/auth/client"
import { currentLanguage } from "@even/i18n/react"

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The organization the shell shows: mail asks for that one's mailboxes. Null outside the shell. */
let organizationId: string | null = null

export function setMailOrganization(id: string | null) {
  organizationId = id
}

/** Who is asking, and in which organization, for any request to the API. */
export function requestHeaders(init?: HeadersInit) {
  const headers = new Headers(init)
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value)
  if (organizationId) headers.set("X-Even-Organization", organizationId)
  return headers
}

/** For binary answers, such as attachments. */
export async function apiBlob(path: string, init?: RequestInit): Promise<Blob> {
  const headers = requestHeaders(init?.headers)
  const response = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers,
    credentials: "include",
  })
  if (!response.ok) throw new ApiError(response.statusText, response.status)
  return response.blob()
}

/** JSON request against the Even API with the shared session cookie (or desktop token). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = requestHeaders(init?.headers)
  headers.set("Accept-Language", currentLanguage())
  const response = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers,
    credentials: "include",
  })
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new ApiError(body?.error ?? response.statusText, response.status)
  return body as T
}
