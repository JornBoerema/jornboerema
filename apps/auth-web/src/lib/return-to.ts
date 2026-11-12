import { useSearchParams } from "react-router"
import { isAllowedReturn } from "@evido/auth/client"

/**
 * Where to go after signing in: a page of this site, or an Even app on the
 * same domain. Anything else falls back to the account page.
 */
export function safeReturnTo(value: string | null) {
  if (!value) return "/"
  if (value.startsWith("/") && !value.startsWith("//")) return value
  try {
    const url = new URL(value)
    return isAllowedReturn(url) ? url.toString() : "/"
  } catch {
    return "/"
  }
}

export function useReturnTo() {
  const [params] = useSearchParams()
  return safeReturnTo(params.get("returnTo"))
}

/** This page, to come back to after signing in. */
export const here = () => `${window.location.pathname}${window.location.search}`
