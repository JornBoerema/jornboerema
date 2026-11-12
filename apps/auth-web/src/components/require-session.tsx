import type { ReactNode } from "react"
import { Navigate } from "react-router"
import { authClient } from "@/lib/auth-client"
import { here } from "@/lib/return-to"

type SessionData = NonNullable<ReturnType<typeof authClient.useSession>["data"]>

/** Renders children only with a session; otherwise signs in first and comes back. */
export function RequireSession({ children }: { children: (session: SessionData) => ReactNode }) {
  const { data, isPending } = authClient.useSession()
  if (isPending) return null
  if (!data) return <Navigate replace to={`/login?returnTo=${encodeURIComponent(here())}`} />
  return children(data)
}
