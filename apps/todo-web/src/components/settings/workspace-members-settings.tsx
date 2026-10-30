import { useState } from "react"
import { toast } from "sonner"
import { canManageWorkspace, type WorkspaceSummary } from "@evido/todo-core/workspaces"
import { useI18n } from "@/i18n"
import { useWorkspaceCommand, useWorkspaceMembers } from "@/lib/workspaces"
import { Mail, UserAdd } from "@/components/icons"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@evido/ui/components/native-select"
import { Skeleton } from "@evido/ui/components/skeleton"
import { Alert, AlertDescription } from "@evido/ui/components/alert"
import { Badge } from "@evido/ui/components/badge"

export function WorkspaceMembersSettings({
  userId,
  workspace,
}: {
  userId: string
  workspace: WorkspaceSummary
}) {
  const { t, locale } = useI18n()
  const s = t.settings
  const roleHelp = { admin: s.members.adminHelp, member: s.members.memberHelp }
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
      toast.error(error instanceof Error ? error.message : s.common.failed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {canManage && (
        <SettingsSection
          title={s.members.inviteTitle}
          description={s.members.inviteHelp}
        >
          <SettingsRow title={s.members.email} htmlFor="invite-email" description={roleHelp[role]}>
            <form
              className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap"
              onSubmit={(event) => {
                event.preventDefault()
                const to = email.trim()
                if (!to) return
                void perform("invite", async () => {
                  await command({ type: "invite", workspaceId: workspace.id, email: to, role })
                  setEmail("")
                  toast.success(s.members.inviteSent(to))
                })
              }}
            >
              <Input
                id="invite-email"
                className="min-w-0 flex-1 sm:w-56"
                type="email"
                placeholder={s.members.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
                disabled={!!busy}
              />
              <NativeSelect
                aria-label={s.members.role}
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                disabled={!!busy}
              >
                <NativeSelectOption value="member">{s.roles.member}</NativeSelectOption>
                <NativeSelectOption value="admin">{s.roles.admin}</NativeSelectOption>
              </NativeSelect>
              <Button type="submit" disabled={!!busy || !email.trim()}>
                <UserAdd data-icon="inline-start" />
                {busy === "invite" ? s.common.sending : s.members.invite}
              </Button>
            </form>
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection
        title={s.members.title}
        description={canManage ? s.members.manageHelp : s.members.readOnlyHelp}
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
                title={member.userId === userId ? s.members.you(member.name) : member.name}
                description={member.email}
              >
                {editable ? (
                  <>
                    <NativeSelect
                      aria-label={s.members.roleOf(member.name)}
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
                      <NativeSelectOption value="member">{s.roles.member}</NativeSelectOption>
                      <NativeSelectOption value="admin">{s.roles.admin}</NativeSelectOption>
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
                          toast.success(s.members.removed(member.name))
                        })
                      }
                    >
                      {s.members.remove}
                    </Button>
                  </>
                ) : (
                  <Badge variant="secondary">{s.roles[member.role]}</Badge>
                )}
              </SettingsRow>
            )
          })
        )}
      </SettingsSection>

      {!!query.data?.invitations.length && (
        <SettingsSection title={s.members.pendingTitle}>
          {query.data.invitations.map((invite) => (
            <SettingsRow
              key={invite.id}
              title={invite.email}
              description={s.members.validUntil(
                s.roles[invite.role],
                new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(new Date(invite.expiresAt))
              )}
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
                        toast.success(s.members.resent(invite.email))
                      })
                    }
                  >
                    <Mail data-icon="inline-start" />
                    {s.members.resend}
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
                    {s.members.revoke}
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
