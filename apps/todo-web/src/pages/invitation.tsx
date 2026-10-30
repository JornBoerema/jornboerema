import { Link, useParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import type { WorkspaceRole } from "@evido/todo-core/workspaces"
import { apiFetch } from "@/lib/api"
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
  useTitle("Uitnodiging voor een workspace")
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
        <h1>Uitnodiging niet beschikbaar</h1>
        <p>Deze link is verlopen of ingetrokken. Vraag de eigenaar om een nieuwe uitnodiging.</p>
        <Button asChild variant="outline">
          <Link to="/">Naar je lijsten</Link>
        </Button>
      </section>
    )
  const returnTo = encodeURIComponent(`/uitnodiging/${token}`)
  return (
    <section className="auth-form">
      <h1>{invite.signedIn ? `Doe mee met ${invite.workspaceName}` : "Je bent uitgenodigd"}</h1>
      <p className="text-muted-foreground">
        {invite.signedIn
          ? `Je wordt ${invite.role === "admin" ? "beheerder" : "lid"} van deze workspace en ziet al zijn lijsten.`
          : `Je bent uitgenodigd voor de workspace ${invite.workspaceName}. Maak een account aan of log in om de uitnodiging te accepteren.`}
      </p>
      <p className="text-sm">Gebruik het e-mailadres waarop je de uitnodiging hebt ontvangen.</p>
      {invite.signedIn ? (
        <AcceptInvitation token={token} wrongAccount={invite.wrongAccount} />
      ) : (
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link to={`/registreren?returnTo=${returnTo}`}>Account aanmaken</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/inloggen?returnTo=${returnTo}`}>Ik heb al een account</Link>
          </Button>
        </div>
      )}
    </section>
  )
}
