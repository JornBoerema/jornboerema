import { currentLanguage } from "@evido/i18n/react"
import { createEvidoAuthClient } from "@evido/auth/client"
import { API_URL } from "./api"

export const authClient = createEvidoAuthClient(API_URL, { language: currentLanguage })

/** Signs out and reloads, so nothing of this user stays in memory or in the browser. */
export async function signOut() {
  const { clearMailCache } = await import("@/lib/cache")
  await clearMailCache()
  await authClient.signOut()
  window.location.assign("/login")
}
