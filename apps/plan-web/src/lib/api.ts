import { authHeaders } from "@even/auth/client"
import { currentLanguage } from "@even/i18n/react"

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

export class ApiError extends Error {
  status: number
  body: Record<string, unknown> | null
  constructor(message: string, status: number, body: Record<string, unknown> | null) {
    super(message)
    this.status = status
    this.body = body
  }
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The organization the shell shows: its mailboxes are the ones whose calendars show. */
let organizationId: string | null = null

export function setPlanOrganization(id: string | null) {
  organizationId = id
}

/** JSON request against the Even API with the shared session cookie (or desktop token). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value)
  if (organizationId) headers.set("X-Even-Organization", organizationId)
  headers.set("Accept-Language", currentLanguage())
  if (init?.body) headers.set("Content-Type", "application/json")
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init, headers, credentials: "include" })
  const body = (await response.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null
  if (!response.ok) throw new ApiError(body?.error ?? response.statusText, response.status, body)
  return body as T
}
