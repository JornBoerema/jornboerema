import { currentLanguage } from "@even/i18n/react"
import { createEvenAuthClient } from "@even/auth/client"
import { API_URL } from "./api"

export const authClient = createEvenAuthClient(API_URL, { language: currentLanguage })

/** Signs out and reloads, so nothing of this user stays in memory or in the browser. */
export async function signOut() {
  const { clearMailCache } = await import("@/lib/cache")
  await clearMailCache()
  await authClient.signOut()
  window.location.assign("/login")
}
