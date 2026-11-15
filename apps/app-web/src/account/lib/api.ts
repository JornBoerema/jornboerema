export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

/** A JSON call to the API with the session cookie; failures throw the API's own message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown; language?: string } = {}): Promise<T> {
  const { json, language, headers, ...rest } = init
  const response = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    credentials: "include",
    ...rest,
    headers: {
      ...(json !== undefined && { "Content-Type": "application/json" }),
      ...(language && { "Accept-Language": language }),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? response.statusText)
  return body
}
