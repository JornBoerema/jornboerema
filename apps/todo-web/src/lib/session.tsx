import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import { authClient } from "@/lib/auth-client"
import { PageLoading } from "@/components/page-loading"

export type SessionUser = { id: string; name: string; email: string; emailVerified: boolean }

/** Renders children only with a session; otherwise sends the visitor to login. */
export function RequireSession({ children }: { children: (user: SessionUser) => ReactNode }) {
  const { data, isPending } = authClient.useSession()
  const location = useLocation()
  if (isPending) return <PageLoading />
  if (!data) {
    // Better Auth appends ?error=... when an e-mail verification link failed.
    const error = new URLSearchParams(location.search).get("error")
    return <Navigate replace to={error ? `/inloggen?error=${encodeURIComponent(error)}` : "/inloggen"} />
  }
  return children(data.user)
}
