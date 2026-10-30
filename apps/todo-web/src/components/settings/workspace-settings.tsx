import { useEffect } from "react"
import { useSearchParams } from "react-router"
import type { WorkspaceSummary } from "@evido/todo-core/workspaces"
import { SettingsDialog, type SettingsPage } from "@evido/ui/components/settings-dialog"
import { Palette, Settings, Share, UserCircle, Users } from "@/components/icons"
import { AppearanceSettings } from "./appearance-settings"
import { AccountSettings } from "./account-settings"
import { ConnectionsSettings } from "./connections-settings"
import { WorkspaceGeneralSettings } from "./workspace-general-settings"
import { WorkspaceMembersSettings } from "./workspace-members-settings"

const PARAM = "instellingen"

/** Settings modal, opened via `?instellingen=<page>` so it is linkable. */
export function useSettings() {
  const [params, setParams] = useSearchParams()
  const page = params.get(PARAM)
  const setPage = (next: string | null, replace = false) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next) updated.set(PARAM, next)
        else updated.delete(PARAM)
        return updated
      },
      { replace }
    )
  return { page, open: (id = "account") => setPage(id), close: () => setPage(null), setPage }
}

export function WorkspaceSettings({
  user,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
}: {
  user: { id: string; name: string; email: string }
  workspaces: WorkspaceSummary[]
  activeWorkspace: WorkspaceSummary
  onSelectWorkspace: (id: string) => void
}) {
  const { page, open, close, setPage } = useSettings()
  useEffect(() => {
    // ⌘, / Ctrl+, opens settings, like most desktop apps.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        open()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })
  const pages: SettingsPage[] = [
    {
      id: "account",
      label: "Account",
      icon: <UserCircle aria-hidden="true" />,
      keywords: ["profiel", "naam", "e-mail", "wachtwoord", "verwijderen"],
    },
    {
      id: "weergave",
      label: "Weergave",
      icon: <Palette aria-hidden="true" />,
      keywords: ["thema", "donker", "dark mode", "licht", "kleur", "appearance"],
    },
    {
      id: "koppelingen",
      label: "Koppelingen",
      icon: <Share aria-hidden="true" />,
      keywords: ["mcp", "chatgpt", "ai"],
    },
    {
      id: "workspace",
      label: "Algemeen",
      icon: <Settings aria-hidden="true" />,
      group: "Workspace-instellingen",
      keywords: ["workspace", "naam", "verwijderen", "verlaten"],
    },
    {
      id: "leden",
      label: "Leden",
      icon: <Users aria-hidden="true" />,
      group: "Workspace-instellingen",
      keywords: ["workspace", "uitnodigen", "rollen", "beheerder"],
    },
  ]
  const active = pages.some((p) => p.id === page) ? page! : "account"
  return (
    <SettingsDialog
      open={page !== null}
      onOpenChange={(open) => !open && close()}
      pages={pages}
      activePage={active}
      onActivePageChange={(id) => setPage(id, true)}
    >
      {active === "account" ? (
        <AccountSettings user={user} />
      ) : active === "weergave" ? (
        <AppearanceSettings />
      ) : active === "koppelingen" ? (
        <ConnectionsSettings />
      ) : active === "workspace" ? (
        <WorkspaceGeneralSettings
          key={activeWorkspace.id}
          userId={user.id}
          workspace={activeWorkspace}
          isLast={workspaces.length === 1}
          onGone={() => onSelectWorkspace(workspaces.find((w) => w.id !== activeWorkspace.id)!.id)}
        />
      ) : (
        <WorkspaceMembersSettings userId={user.id} workspace={activeWorkspace} />
      )}
    </SettingsDialog>
  )
}
