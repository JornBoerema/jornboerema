import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import { authClient } from "@/lib/auth-client"
import { PageLoading } from "@/components/page-loading"

export type SessionUser = { id: string; name: string; email: string; emailVerified: boolean }

/** Renders children only with a session; otherwise sends the visitor to login. */
export function RequireSession({
  children,
  loading = <PageLoading />,
}: {
  children: (user: SessionUser) => ReactNode
  /** The page's own loading screen, so the steps after this one show the same. */
  loading?: ReactNode
}) {
  const { data, isPending } = authClient.useSession()
  const location = useLocation()
  if (isPending) return loading
  if (!data) {
    // Better Auth appends ?error=... when an e-mail verification link failed.
    const error = new URLSearchParams(location.search).get("error")
    return <Navigate replace to={error ? `/login?error=${encodeURIComponent(error)}` : "/login"} />
  }
  return children(data.user)
}
