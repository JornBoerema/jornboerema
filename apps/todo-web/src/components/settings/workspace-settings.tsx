import { useEffect } from "react"
import { useSearchParams } from "react-router"
import type { WorkspaceSummary } from "@evido/todo-core/workspaces"
import { SettingsDialog, type SettingsPage } from "@evido/ui/components/settings-dialog"
import { AboutSettings, useAboutPage } from "@evido/ui/components/desktop-app"
import { Palette, Settings, Share, UserCircle, Users } from "@/components/icons"
import { AppearanceSettings } from "./appearance-settings"
import { useI18n } from "@/i18n"
import { AccountSettings } from "./account-settings"
import { ConnectionsSettings } from "./connections-settings"
import { WorkspaceGeneralSettings } from "./workspace-general-settings"
import { WorkspaceMembersSettings } from "./workspace-members-settings"

const PARAM = "settings"

/** Settings modal, opened via `?settings=<page>` so it is linkable. */
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
  const { t } = useI18n()
  const s = t.settings
  const words = (list: string) => list.split(" | ")
  const about = useAboutPage()
  // Page ids are part of the URL (?settings=…) and stay the same in every language.
  const pages: SettingsPage[] = [
    {
      id: "account",
      label: s.pages.account,
      icon: <UserCircle aria-hidden="true" />,
      keywords: words(s.keywords.account),
    },
    {
      id: "appearance",
      label: s.pages.appearance,
      icon: <Palette aria-hidden="true" />,
      keywords: words(s.keywords.appearance),
    },
    {
      id: "connections",
      label: s.pages.connections,
      icon: <Share aria-hidden="true" />,
      keywords: words(s.keywords.connections),
    },
    {
      id: "workspace",
      label: s.pages.general,
      icon: <Settings aria-hidden="true" />,
      group: s.pages.workspaceGroup,
      keywords: words(s.keywords.general),
    },
    {
      id: "members",
      label: s.pages.members,
      icon: <Users aria-hidden="true" />,
      group: s.pages.workspaceGroup,
      keywords: words(s.keywords.members),
    },
    // Only in the desktop app: its version and updates.
    ...(about ? [about] : []),
  ]
  const active = pages.some((p) => p.id === page) ? page! : "account"
  return (
    <SettingsDialog
      open={page !== null}
      onOpenChange={(open) => !open && close()}
      pages={pages}
      activePage={active}
      onActivePageChange={(id) => setPage(id, true)}
      labels={s.dialog}
    >
      {active === "account" ? (
        <AccountSettings user={user} />
      ) : active === "appearance" ? (
        <AppearanceSettings />
      ) : active === "connections" ? (
        <ConnectionsSettings />
      ) : active === "about" ? (
        <AboutSettings />
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
