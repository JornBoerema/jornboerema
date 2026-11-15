import { useEffect } from "react"
import { useSearchParams } from "react-router"
import type { WorkspaceSummary } from "@even/todo-core/workspaces"
import { SettingsDialog, type SettingsPage } from "@even/ui/components/settings-dialog"
import { AboutSettings, useAboutPage } from "@even/ui/components/desktop-app"
import { DesktopSettingsPages, useDesktopSettings } from "@even/ui/components/desktop-settings"
import { Building, CreditCard, Folder, Kanban, Palette, Share, UserCircle, Users } from "@/components/icons"
import { ProjectsSettings, StatusesSettings, type BoardSettingsProps } from "./board-settings"
import { AppearanceSettings } from "./appearance-settings"
import { useI18n } from "@/i18n"
import { AccountSettings } from "./account-settings"
import { ConnectionsSettings } from "./connections-settings"
import { WorkspaceGeneralSettings } from "./workspace-general-settings"
import { WorkspaceMembersSettings } from "./workspace-members-settings"
import { OrganizationBillingSettings } from "./organization-billing-settings"

const PARAM = "settings"

/**
 * Settings modal, opened via `?settings=<page>` so it is linkable. In the desktop
 * app the settings of every app share one window, which this opens instead.
 */
export function useSettings() {
  const desktop = useDesktopSettings("todo")
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

/** The settings pages; in the desktop app only the lists' own ones. */
function useSettingsPages(desktop: boolean): SettingsPage[] {
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
      id: "connections",
      label: s.pages.connections,
      icon: <Share aria-hidden="true" />,
      keywords: words(s.keywords.connections),
    },
    // The active organization's pages belong to no one app: they sit with the account.
    {
      id: "workspace",
      label: s.pages.workspaceGroup,
      icon: <Building aria-hidden="true" />,
      keywords: words(s.keywords.general),
    },
    {
      id: "members",
      label: s.pages.members,
      icon: <Users aria-hidden="true" />,
      keywords: words(s.keywords.members),
    },
    {
      id: "billing",
      label: s.pages.billing,
      icon: <CreditCard aria-hidden="true" />,
      keywords: words(s.keywords.billing),
    },
    {
      id: "statuses",
      label: s.pages.statuses,
      icon: <Kanban aria-hidden="true" />,
      group: s.pages.workspaceGroup,
      keywords: words(s.keywords.statuses),
    },
    {
      id: "projects",
      label: s.pages.projects,
      icon: <Folder aria-hidden="true" />,
      group: s.pages.workspaceGroup,
      keywords: words(s.keywords.projects),
    },
    // Only in the desktop app: its version and updates.
    ...(about ? [about] : []),
  ]
  // In the desktop app the window already has the account, appearance and about pages;
  // this adds the lists' part of the shared connections page and its own pages.
  return desktop ? all.filter((p) => !["account", "appearance", "about"].includes(p.id)) : all
}

/**
 * The lists' pages in the desktop app's settings from the moment it starts, so they
 * are listed together with the other apps' pages, also before the lists first open.
 * The lists draw a page's content once they run (see {@link WorkspaceSettings}).
 */
export function DesktopSettingsNav() {
  const pages = useSettingsPages(true)
  return <DesktopSettingsPages app="todo" pages={pages}>{() => null}</DesktopSettingsPages>
}

export function WorkspaceSettings({
  user,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  board,
}: {
  user: { id: string; name: string; email: string }
  workspaces: WorkspaceSummary[]
  activeWorkspace: WorkspaceSummary
  onSelectWorkspace: (id: string) => void
  /** The open workspace's data, for the board settings (statuses, projects). */
  board: Omit<BoardSettingsProps, "workspaceId">
}) {
  const { page, open, close, setPage } = useSettings()
  const desktop = useDesktopSettings("todo") !== null
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
  const pages = useSettingsPages(desktop)
  const { t } = useI18n()
  const active = pages.some((p) => p.id === page) ? page! : "account"
  const content = (id: string) =>
    id === "account" ? (
      <AccountSettings user={user} />
    ) : id === "appearance" ? (
      <AppearanceSettings />
    ) : id === "connections" ? (
      <ConnectionsSettings title={desktop ? "Even doen" : undefined} />
    ) : id === "about" ? (
      <AboutSettings />
    ) : id === "workspace" ? (
      <WorkspaceGeneralSettings
        key={activeWorkspace.id}
        userId={user.id}
        workspace={activeWorkspace}
        isLast={activeWorkspace.personal}
        onGone={() => onSelectWorkspace((workspaces.find((w) => w.personal) ?? workspaces.find((w) => w.id !== activeWorkspace.id))!.id)}
      />
    ) : id === "billing" ? (
      <OrganizationBillingSettings
        key={activeWorkspace.id}
        workspace={activeWorkspace}
        onShowMembers={() => (desktop ? open("members") : setPage("members", true))}
      />
    ) : id === "statuses" ? (
      <StatusesSettings workspaceId={activeWorkspace.id} {...board} />
    ) : id === "projects" ? (
      <ProjectsSettings workspaceId={activeWorkspace.id} {...board} />
    ) : (
      <WorkspaceMembersSettings userId={user.id} workspace={activeWorkspace} />
    )
  if (desktop) return <DesktopSettingsPages app="todo" pages={pages}>{content}</DesktopSettingsPages>
  return (
    <SettingsDialog
      open={page !== null}
      onOpenChange={(open) => !open && close()}
      pages={pages}
      activePage={active}
      onActivePageChange={(id) => setPage(id, true)}
      labels={t.settings.dialog}
    >
      {content(active)}
    </SettingsDialog>
  )
}
