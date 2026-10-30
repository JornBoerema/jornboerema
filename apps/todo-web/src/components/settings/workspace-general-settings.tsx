import { useState } from "react"
import { toast } from "sonner"
import {
  canManageWorkspace,
  workspaceRoleLabels,
  type WorkspaceSummary,
} from "@evido/todo-core/workspaces"
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
      toast.error(error instanceof Error ? error.message : "Dit is niet gelukt.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <SettingsSection title="Algemeen" description="Iedereen in deze workspace ziet en bewerkt dezelfde lijsten.">
        <SettingsRow
          title="Naam"
          htmlFor="workspace-settings-name"
          description={canManage ? undefined : "Alleen de eigenaar en beheerders kunnen de naam wijzigen."}
        >
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              const next = name.trim()
              if (!next || next === workspace.name) return
              void perform("rename", async () => {
                await command({ type: "rename", workspaceId: workspace.id, name: next })
                toast.success("Naam van de workspace bijgewerkt.")
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
                {busy === "rename" ? "Opslaan…" : "Opslaan"}
              </Button>
            )}
          </form>
        </SettingsRow>
        <SettingsRow title="Jouw rol" description="Bepaalt of je leden en instellingen kunt beheren.">
          <span className="text-sm">{workspaceRoleLabels[workspace.role]}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Gevarenzone" destructive>
        {isOwner ? (
          <SettingsRow
            title="Workspace verwijderen"
            destructive
            description={
              isLast
                ? "Dit is je enige workspace. Maak eerst een andere aan."
                : "Alle lijsten en notities in deze workspace verdwijnen, voor alle leden."
            }
          >
            <Button variant="destructive" disabled={isLast || !!busy} onClick={() => setConfirming(true)}>
              <Trash2 data-icon="inline-start" />
              Verwijderen
            </Button>
          </SettingsRow>
        ) : (
          <SettingsRow
            title="Workspace verlaten"
            destructive
            description="Je verliest toegang tot alle lijsten in deze workspace. Een beheerder kan je opnieuw uitnodigen."
          >
            <Button variant="destructive" disabled={!!busy} onClick={() => setConfirming(true)}>
              Verlaten
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>

      <AlertDialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOwner ? `‘${workspace.name}’ verwijderen?` : `‘${workspace.name}’ verlaten?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner
                ? "Alle lijsten, taken en notities in deze workspace worden definitief verwijderd, ook voor de andere leden."
                : "Je ziet de lijsten van deze workspace daarna niet meer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!!busy}
              onClick={(event) => {
                event.preventDefault()
                void perform("gone", async () => {
                  await command({ type: isOwner ? "delete" : "leave", workspaceId: workspace.id })
                  setConfirming(false)
                  toast.success(isOwner ? "Workspace verwijderd." : "Je hebt de workspace verlaten.")
                  onGone()
                })
              }}
            >
              {busy ? "Even geduld…" : isOwner ? "Definitief verwijderen" : "Verlaten"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
