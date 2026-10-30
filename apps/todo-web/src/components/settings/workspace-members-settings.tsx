import { useState } from "react"
import { toast } from "sonner"
import {
  canManageWorkspace,
  workspaceRoleLabels,
  type WorkspaceSummary,
} from "@evido/todo-core/workspaces"
import { useWorkspaceCommand, useWorkspaceMembers } from "@/lib/workspaces"
import { Mail, UserAdd } from "@/components/icons"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@evido/ui/components/native-select"
import { Skeleton } from "@evido/ui/components/skeleton"
import { Alert, AlertDescription } from "@evido/ui/components/alert"
import { Badge } from "@evido/ui/components/badge"

const roleHelp = {
  admin: "Beheerders kunnen leden uitnodigen en de workspace beheren.",
  member: "Leden kunnen alle lijsten bekijken en bewerken.",
}

export function WorkspaceMembersSettings({
  userId,
  workspace,
}: {
  userId: string
  workspace: WorkspaceSummary
}) {
  const query = useWorkspaceMembers(workspace.id)
  const command = useWorkspaceCommand(userId)
  const canManage = canManageWorkspace(workspace.role)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"admin" | "member">("member")
  const [busy, setBusy] = useState<string | null>(null)

  async function perform(action: string, work: () => Promise<void>) {
    setBusy(action)
    try {
      await work()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dit is niet gelukt.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {canManage && (
        <SettingsSection
          title="Leden uitnodigen"
          description="De ontvanger krijgt een e-mail en accepteert met een account op hetzelfde e-mailadres."
        >
          <SettingsRow title="E-mailadres" htmlFor="invite-email" description={roleHelp[role]}>
            <form
              className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap"
              onSubmit={(event) => {
                event.preventDefault()
                const to = email.trim()
                if (!to) return
                void perform("invite", async () => {
                  await command({ type: "invite", workspaceId: workspace.id, email: to, role })
                  setEmail("")
                  toast.success(`Uitnodiging verstuurd naar ${to}.`)
                })
              }}
            >
              <Input
                id="invite-email"
                className="min-w-0 flex-1 sm:w-56"
                type="email"
                placeholder="naam@voorbeeld.nl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
                disabled={!!busy}
              />
              <NativeSelect
                aria-label="Rol"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                disabled={!!busy}
              >
                <NativeSelectOption value="member">Lid</NativeSelectOption>
                <NativeSelectOption value="admin">Beheerder</NativeSelectOption>
              </NativeSelect>
              <Button type="submit" disabled={!!busy || !email.trim()}>
                <UserAdd data-icon="inline-start" />
                {busy === "invite" ? "Versturen…" : "Uitnodigen"}
              </Button>
            </form>
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection
        title="Leden"
        description={
          canManage
            ? "Pas rollen aan of verwijder iemand uit de workspace."
            : "Alleen de eigenaar en beheerders kunnen leden beheren."
        }
      >
        {query.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <div className="p-5">
            <Alert variant="destructive">
              <AlertDescription>{query.error.message}</AlertDescription>
            </Alert>
          </div>
        ) : (
          query.data.members.map((member) => {
            const editable = canManage && member.role !== "owner" && member.userId !== userId
            return (
              <SettingsRow
                key={member.id}
                title={member.userId === userId ? `${member.name} (jij)` : member.name}
                description={member.email}
              >
                {editable ? (
                  <>
                    <NativeSelect
                      aria-label={`Rol van ${member.name}`}
                      value={member.role}
                      disabled={!!busy}
                      onChange={(e) =>
                        void perform(`role-${member.id}`, () =>
                          command({
                            type: "update-member",
                            workspaceId: workspace.id,
                            memberId: member.id,
                            role: e.target.value as "admin" | "member",
                          })
                        )
                      }
                    >
                      <NativeSelectOption value="member">Lid</NativeSelectOption>
                      <NativeSelectOption value="admin">Beheerder</NativeSelectOption>
                    </NativeSelect>
                    <Button
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() =>
                        void perform(`remove-${member.id}`, async () => {
                          await command({
                            type: "remove-member",
                            workspaceId: workspace.id,
                            memberId: member.id,
                          })
                          toast.success(`${member.name} is verwijderd uit de workspace.`)
                        })
                      }
                    >
                      Verwijderen
                    </Button>
                  </>
                ) : (
                  <Badge variant="secondary">{workspaceRoleLabels[member.role]}</Badge>
                )}
              </SettingsRow>
            )
          })
        )}
      </SettingsSection>

      {!!query.data?.invitations.length && (
        <SettingsSection title="Openstaande uitnodigingen">
          {query.data.invitations.map((invite) => (
            <SettingsRow
              key={invite.id}
              title={invite.email}
              description={`${workspaceRoleLabels[invite.role]} · geldig tot ${new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long" }).format(new Date(invite.expiresAt))}`}
            >
              {canManage && (
                <>
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      void perform(`resend-${invite.id}`, async () => {
                        await command({
                          type: "invite",
                          workspaceId: workspace.id,
                          email: invite.email,
                          role: invite.role === "admin" ? "admin" : "member",
                        })
                        toast.success(`Uitnodiging opnieuw verstuurd naar ${invite.email}.`)
                      })
                    }
                  >
                    <Mail data-icon="inline-start" />
                    Opnieuw sturen
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() =>
                      void perform(`revoke-${invite.id}`, () =>
                        command({
                          type: "revoke-invite",
                          workspaceId: workspace.id,
                          invitationId: invite.id,
                        })
                      )
                    }
                  >
                    Intrekken
                  </Button>
                </>
              )}
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
    </>
  )
}
