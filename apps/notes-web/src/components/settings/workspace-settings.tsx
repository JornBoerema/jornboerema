import { useEffect } from "react"
import { useSearchParams } from "react-router"
import type { WorkspaceSummary } from "@evido/todo-core/workspaces"
import { SettingsDialog, type SettingsPage } from "@evido/ui/components/settings-dialog"
import { AboutSettings, useAboutPage } from "@evido/ui/components/desktop-app"
import { DesktopSettingsPages, useDesktopSettings } from "@evido/ui/components/desktop-settings"
import { Palette, Settings, UserCircle, Users } from "@/components/icons"
import { AppearanceSettings } from "./appearance-settings"
import { useI18n } from "@/i18n"
import { AccountSettings } from "./account-settings"
import { WorkspaceGeneralSettings } from "./workspace-general-settings"
import { WorkspaceMembersSettings } from "./workspace-members-settings"

const PARAM = "settings"

/**
 * Settings modal, opened via `?settings=<page>` so it is linkable. In the desktop
 * app the settings of every app share one window, which this opens instead.
 */
export function useSettings() {
  const desktop = useDesktopSettings("notes")
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
  if (desktop) return { page: null, open: (id?: string) => desktop.open(id), close: desktop.close, setPage }
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
  const desktop = useDesktopSettings("notes") !== null
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
  const all: SettingsPage[] = [
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
  // In the desktop app the window already has the account, appearance and about pages,
  // and Even doen holds the workspace pages (the same workspaces), so notes add none.
  const pages = desktop ? [] : all
  const active = pages.some((p) => p.id === page) ? page! : "account"
  const content = (id: string) =>
    id === "account" ? (
      <AccountSettings user={user} />
    ) : id === "appearance" ? (
      <AppearanceSettings />
    ) : id === "about" ? (
      <AboutSettings />
    ) : id === "workspace" ? (
      <WorkspaceGeneralSettings
        key={activeWorkspace.id}
        userId={user.id}
        workspace={activeWorkspace}
        isLast={workspaces.length === 1}
        onGone={() => onSelectWorkspace(workspaces.find((w) => w.id !== activeWorkspace.id)!.id)}
      />
    ) : (
      <WorkspaceMembersSettings userId={user.id} workspace={activeWorkspace} />
    )
  if (desktop) return <DesktopSettingsPages app="notes" pages={pages}>{content}</DesktopSettingsPages>
  return (
    <SettingsDialog
      open={page !== null}
      onOpenChange={(open) => !open && close()}
      pages={pages}
      activePage={active}
      onActivePageChange={(id) => setPage(id, true)}
      labels={s.dialog}
    >
      {content(active)}
    </SettingsDialog>
  )
}
