import { Link, useParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import type { WorkspaceRole } from "@evido/todo-core/workspaces"
import { apiFetch } from "@/lib/api"
import { useI18n } from "@/i18n"
import { useTitle } from "@/lib/use-title"
import { AcceptInvitation } from "@/components/accept-invitation"
import { Button } from "@evido/ui/components/button"
import { Skeleton } from "@evido/ui/components/skeleton"

type Invitation = {
  workspaceName: string
  role: WorkspaceRole
  signedIn: boolean
  wrongAccount: boolean
}

export function InvitationPage() {
  const { token = "" } = useParams()
  const { t: all } = useI18n()
  const t = all.auth.invitation
  useTitle(t.pageTitle)
  const query = useQuery({
    queryKey: ["invitation", token],
    queryFn: async () => {
      const response = await apiFetch(`/api/invitations/${token}`)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as Invitation
    },
  })
  if (query.isPending) return <Skeleton className="h-80 w-full max-w-sm" />
  const invite = query.data
  if (!invite)
    return (
      <section className="auth-form">
        <h1>{t.unavailableTitle}</h1>
        <p>{t.unavailableDescription}</p>
        <Button asChild variant="outline">
          <Link to="/">{all.common.toYourLists}</Link>
        </Button>
      </section>
    )
  const returnTo = encodeURIComponent(`/invite/${token}`)
  return (
    <section className="auth-form">
      <h1>{invite.signedIn ? t.joinTitle(invite.workspaceName) : t.invitedTitle}</h1>
      <p className="text-muted-foreground">
        {invite.signedIn
          ? t.joinDescription(invite.role === "admin" ? "admin" : "member")
          : t.invitedDescription(invite.workspaceName)}
      </p>
      <p className="text-sm">{t.useInvitedEmail}</p>
      {invite.signedIn ? (
        <AcceptInvitation token={token} wrongAccount={invite.wrongAccount} />
      ) : (
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link to={`/signup?returnTo=${returnTo}`}>{t.createAccount}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/login?returnTo=${returnTo}`}>{t.haveAccount}</Link>
          </Button>
        </div>
      )}
    </section>
  )
}
