import { Link, useParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import type { WorkspaceRole } from "@even/todo-core/workspaces"
import { apiFetch } from "@/lib/api"
import { useI18n } from "@/i18n"
import { useTitle } from "@/lib/use-title"
import { AcceptInvitation } from "@/components/accept-invitation"
import { Button } from "@even/ui/components/button"
import { Skeleton, SkeletonLine } from "@even/ui/components/skeleton"

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
  if (query.isPending) return <InvitationLoading label={all.common.loading} />
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

/** The invitation while it loads, line for line: the title, what it is about, and the two ways in. */
function InvitationLoading({ label }: { label: string }) {
  return (
    <section className="auth-form" role="status" aria-label={label}>
      <div aria-hidden="true">
        <SkeletonLine className="h-[35px]" bar="h-7 w-full" />
        <SkeletonLine className="h-[35px]" bar="h-7 w-2/3" />
      </div>
      <div aria-hidden="true">
        <SkeletonLine className="h-6" bar="w-full" />
        <SkeletonLine className="h-6" bar="w-4/5" />
      </div>
      <SkeletonLine className="h-6" bar="w-3/5" />
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-[42px] w-full" />
        <Skeleton className="h-[42px] w-full" />
      </div>
    </section>
  )
}
