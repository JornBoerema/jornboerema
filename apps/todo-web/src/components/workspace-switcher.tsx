import { useState } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { WorkspaceSummary } from "@evido/todo-core/workspaces"
import { authClient } from "@/lib/auth-client"
import { useWorkspaceCommand } from "@/lib/workspaces"
import { useI18n } from "@/i18n"
import { Check, ChevronsUpDown, LogOut, Plus, Settings } from "@/components/icons"
import { useSettings } from "@/components/settings/workspace-settings"
import { useInDesktop } from "@evido/ui/components/app-switcher"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { Field, FieldGroup, FieldLabel } from "@evido/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@evido/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"

type WorkspaceMenuProps = {
  user: { id: string; name: string; email: string }
  workspaces: WorkspaceSummary[]
  active: WorkspaceSummary
  onSelect: (id: string) => void
}

/** Signs out and goes to the sign-in page; says so when it did not work, and throws. */
export function useSignOut() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { t: { workspace: { switcher: t } } } = useI18n()
  return async () => {
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error()
    } catch (error) {
      toast.error(t.signOutFailed)
      throw error
    }
    client.clear()
    navigate("/login", { replace: true })
  }
}

/**
 * Switch workspace, open settings, sign out: the items, and the dialog for a
 * new workspace. The dialog lives outside the menu, which closes before it opens.
 * In the desktop app, whose rail opens settings (with signing out), only workspaces.
 */
export function useWorkspaceMenu(props: WorkspaceMenuProps | null) {
  const settings = useSettings()
  const desktop = useInDesktop()
  const signOutNow = useSignOut()
  const { t: { workspace: { switcher: t } } } = useI18n()
  const command = useWorkspaceCommand(props?.user.id ?? "")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // A shared list has no workspace of the viewer's own.
  if (!props) return { items: null, dialog: null }
  const { workspaces, active, onSelect } = props

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || pending) return
    setPending(true)
    const id = crypto.randomUUID()
    try {
      await command({ type: "create", id, name: name.trim() })
      setCreating(false)
      setName("")
      onSelect(id)
      toast.success(t.created(name.trim()))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.failed)
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    setSigningOut(true)
    try {
      await signOutNow()
    } catch {
      setSigningOut(false)
    }
  }

  const items = (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t.workspaces}</DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => onSelect(workspace.id)}>
            <span className="workspace-avatar is-small" aria-hidden="true">
              {workspace.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {workspace.memberCount > 1 && (
              <span className="text-xs text-muted-foreground">{t.members(workspace.memberCount)}</span>
            )}
            {workspace.id === active.id && <Check aria-label={t.active} />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          {t.newWorkspace}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {!desktop && (
        <>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => settings.open("account")}>
            <Settings aria-hidden="true" />
            {t.settings}
            <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
            <LogOut aria-hidden="true" />
            {signingOut ? t.signingOut : t.signOut}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        </>
      )}
    </>
  )

  const dialog = (
    <Dialog open={creating} onOpenChange={(open) => !pending && setCreating(open)}>
      <DialogContent>
        <form onSubmit={create} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{t.newWorkspace}</DialogTitle>
            <DialogDescription>
              {t.dialogDescription}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-name">{t.name}</FieldLabel>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.namePlaceholder}
                maxLength={60}
                required
                autoFocus
                disabled={pending}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setCreating(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? t.creating : t.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  return { items, dialog }
}

/** Sidebar footer menu on the web: switch workspace, open settings, sign out. */
export function WorkspaceSwitcher({
  user,
  active,
  items,
}: {
  user: { name: string }
  active: WorkspaceSummary
  items: React.ReactNode
}) {
  const { t: { workspace: { switcher: t } } } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="workspace-switcher" aria-label={t.triggerLabel(active.name)}>
          <span className="workspace-avatar" aria-hidden="true">
            {active.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="truncate">{active.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{user.name}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="min-w-(--radix-dropdown-menu-trigger-width)"
      >
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
