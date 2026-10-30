import { useState } from "react"
import { toast } from "sonner"
import { canManageWorkspace, type WorkspaceSummary } from "@evido/todo-core/workspaces"
import { useI18n } from "@/i18n"
import { useWorkspaceCommand } from "@/lib/workspaces"
import { Trash2 } from "@/components/icons"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog"

export function WorkspaceGeneralSettings({
  userId,
  workspace,
  isLast,
  onGone,
}: {
  userId: string
  workspace: WorkspaceSummary
  /** The user's only workspace cannot be deleted or left. */
  isLast: boolean
  /** Called after the user deleted or left this workspace. */
  onGone: () => void
}) {
  const { t } = useI18n()
  const s = t.settings
  const command = useWorkspaceCommand(userId)
  const [name, setName] = useState(workspace.name)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const canManage = canManageWorkspace(workspace.role)
  const isOwner = workspace.role === "owner"

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
      <SettingsSection title={s.workspace.general} description={s.workspace.generalHelp}>
        <SettingsRow
          title={s.workspace.name}
          htmlFor="workspace-settings-name"
          description={canManage ? undefined : s.workspace.nameManagersOnly}
        >
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              const next = name.trim()
              if (!next || next === workspace.name) return
              void perform("rename", async () => {
                await command({ type: "rename", workspaceId: workspace.id, name: next })
                toast.success(s.workspace.renamed)
              })
            }}
          >
            <Input
              id="workspace-settings-name"
              className="sm:w-60"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
              disabled={!canManage || !!busy}
            />
            {canManage && (
              <Button type="submit" disabled={!!busy || !name.trim() || name.trim() === workspace.name}>
                {busy === "rename" ? s.common.saving : s.common.save}
              </Button>
            )}
          </form>
        </SettingsRow>
        <SettingsRow title={s.workspace.yourRole} description={s.workspace.yourRoleHelp}>
          <span className="text-sm">{s.roles[workspace.role]}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={s.common.dangerZone} destructive>
        {isOwner ? (
          <SettingsRow
            title={s.workspace.deleteWorkspace}
            destructive
            description={
              isLast ? s.workspace.deleteLastHelp : s.workspace.deleteHelp
            }
          >
            <Button variant="destructive" disabled={isLast || !!busy} onClick={() => setConfirming(true)}>
              <Trash2 data-icon="inline-start" />
              {s.common.delete}
            </Button>
          </SettingsRow>
        ) : (
          <SettingsRow
            title={s.workspace.leaveWorkspace}
            destructive
            description={s.workspace.leaveHelp}
          >
            <Button variant="destructive" disabled={!!busy} onClick={() => setConfirming(true)}>
              {s.workspace.leave}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>

      <AlertDialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOwner
                ? s.workspace.confirmDeleteTitle(workspace.name)
                : s.workspace.confirmLeaveTitle(workspace.name)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner ? s.workspace.confirmDeleteDescription : s.workspace.confirmLeaveDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>{s.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!!busy}
              onClick={(event) => {
                event.preventDefault()
                void perform("gone", async () => {
                  await command({ type: isOwner ? "delete" : "leave", workspaceId: workspace.id })
                  setConfirming(false)
                  toast.success(isOwner ? s.workspace.deleted : s.workspace.left)
                  onGone()
                })
              }}
            >
              {busy ? s.common.pleaseWait : isOwner ? s.workspace.deletePermanently : s.workspace.leave}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
