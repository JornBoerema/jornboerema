import { Activity, useEffect, useState, type ReactNode } from "react"
import {
  BubbleChatIcon,
  Calendar03Icon,
  CheckmarkSquare02Icon,
  DashboardSquare01Icon,
  Mail01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { MailEmbed } from "@evido/mail-web/embed"
import { DashboardEmbed, TodoEmbed, TodoSettingsNav } from "@evido/todo-web/embed"
import { NotesEmbed } from "@evido/notes-web/embed"
import { AppSwitcherProvider, type AppRequest, type SwitchableApp } from "@evido/ui/components/app-switcher"
import { DesktopSettingsProvider, useDesktopSettings } from "@evido/ui/components/desktop-settings"
import { useCurrentLanguage } from "@evido/i18n/react"
import { DesktopProvider, type DesktopApp } from "@evido/ui/components/desktop-app"
import { cn } from "@evido/ui/lib/utils"
import { AppRail } from "./rail"

export type AppId = "dashboard" | "mail" | "todo" | "notes"

const isMac = navigator.userAgent.includes("Mac")

/** In rail order; the number keys follow it. */
const APP_LIST: { id: Exclude<AppId, "dashboard">; name: string; icon: IconSvgElement }[] = [
  { id: "mail", name: "Even mailen", icon: Mail01Icon },
  { id: "todo", name: "Even doen", icon: CheckmarkSquare02Icon },
  { id: "notes", name: "Even noteren", icon: Note01Icon },
]
/** Shown in the rail, greyed out, until they join APP_LIST. */
const UPCOMING = [
  { id: "plan", name: "Even plannen", icon: Calendar03Icon },
  { id: "chat", name: "Even chatten", icon: BubbleChatIcon },
]

/** On the web each app lives under its own path, which the browser's address shows. */
export const APP_PATHS: Record<AppId, string> = {
  dashboard: "/dashboard",
  mail: "/mail",
  todo: "/todo",
  notes: "/notes",
}

const APP_KEY = "even.desktop.app"

/** The shell's own words; the settings pages come from the apps, in their language. */
const TEXTS = {
  en: {
    title: "Settings",
    description: "Settings for every Even app.",
    search: "Search",
    noResults: "No settings found.",
    close: "Close",
    soon: "Coming soon",
    dashboard: "Dashboard",
  },
  nl: {
    title: "Instellingen",
    description: "Instellingen van alle Even-apps.",
    search: "Zoeken",
    noResults: "Geen instellingen gevonden.",
    close: "Sluiten",
    soon: "Binnenkort",
    dashboard: "Dashboard",
  },
}

const isAppId = (value: unknown): value is AppId =>
  value === "dashboard" || APP_LIST.some((app) => app.id === value)

/** The app the browser's address names: "/todo?list=…" is Even doen. */
function appInAddress(): AppId | null {
  const first = window.location.pathname.split("/")[1]
  return isAppId(first) ? first : null
}

function storedApp(): AppId {
  try {
    const stored = localStorage.getItem(APP_KEY)
    if (isAppId(stored)) return stored
  } catch {
    // No storage: start with the first app.
  }
  return APP_LIST[0].id
}

/** The app to start in. On the web the address decides, and a bare address gets the app's path. */
function firstApp(web: boolean): AppId {
  if (!web) return storedApp()
  const named = appInAddress()
  if (named) return named
  const app = storedApp()
  window.history.replaceState(window.history.state, "", APP_PATHS[app] + window.location.search)
  return app
}

/**
 * Every Even app in one window: the rail to switch between them, and one
 * settings window with every app's pages. The desktop app passes `desktop`
 * (its version and updates); the web passes `web`, which gives each app its
 * path in the browser's address.
 */
export function EvenShell({
  desktop = null,
  web = false,
  railFoot,
}: {
  desktop?: DesktopApp | null
  web?: boolean
  /** Extra buttons at the foot of the rail, above the settings. */
  railFoot?: ReactNode
}) {
  const language = useCurrentLanguage()
  const texts = TEXTS[language] ?? TEXTS.en
  const [active, setActive] = useState(() => firstApp(web))
  // An app mounts the first time it is opened and then stays, hidden, so it
  // keeps its place; while hidden its effects (shortcuts, live updates) stop.
  const [opened, setOpened] = useState<AppId[]>(() => [active, "mail"])
  // The settings hold every app's pages, so while they are open every app runs.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettingsWindow = (open: boolean) => {
    if (open) setOpened(APP_LIST.map((app) => app.id))
    setSettingsOpen(open)
  }

  const shortcut = (index: number) => (isMac ? `⌘${index + 1}` : `Ctrl+${index + 1}`)
  const apps: (SwitchableApp & { id: AppId })[] = APP_LIST.map((app, index) => ({ ...app, shortcut: shortcut(index) }))

  const select = (app: string) => {
    if (!isAppId(app)) return
    setActive(app)
    setOpened((current) => (current.includes(app) ? current : [...current, app]))
    try {
      localStorage.setItem(APP_KEY, app)
    } catch {
      // Starts with the first app next time.
    }
  }

  // A place in another app, asked for from the dashboard: its router goes there.
  const [request, setRequest] = useState<AppRequest | null>(null)
  const open = (app: string, to: string) => {
    if (!isAppId(app)) return
    setRequest((last) => ({ app, to, n: (last?.n ?? 0) + 1 }))
    select(app)
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.shiftKey) return
      // ⌘1 and Ctrl+1 everywhere. A browser may keep those for its own tabs, so on the web
      // Alt+1 does the same.
      const command = (event.metaKey || event.ctrlKey) && !event.altKey
      const alt = web && event.altKey && !event.metaKey && !event.ctrlKey
      if (!command && !alt) return
      // With Alt held the key itself is a symbol; the code still names the digit.
      const app = APP_LIST[Number(event.code.replace("Digit", "")) - 1]
      if (!app) return
      event.preventDefault()
      select(app.id)
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [web])

  // Back and Forward across apps: the address says which one is in front.
  useEffect(() => {
    if (!web) return
    const follow = () => {
      const app = appInAddress()
      if (app) select(app)
    }
    window.addEventListener("popstate", follow)
    return () => window.removeEventListener("popstate", follow)
  }, [web])

  const running = (app: AppId) => active === app || settingsOpen

  return (
    <DesktopProvider value={desktop}>
      <AppSwitcherProvider value={{ apps, active, onSelect: select, paths: web ? APP_PATHS : undefined, open, request }}>
        <DesktopSettingsProvider apps={apps} open={settingsOpen} onOpenChange={openSettingsWindow} labels={texts}>
          {/* Even doen's pages are in the settings from the start, not only once it runs. */}
          <TodoSettingsNav />
          <div className={cn("desktop-app", !web && isMac && "mac", web && "is-web")}>
            <Rail apps={apps} active={active} onSelect={select} texts={texts} foot={railFoot} />
            <div className="desktop-stage">
              {opened.includes("dashboard") && (
                <div className="desktop-pane" hidden={active !== "dashboard"}>
                  <Activity mode={active === "dashboard" ? "visible" : "hidden"}>
                    <DashboardEmbed />
                  </Activity>
                </div>
              )}
              {/* Mail stays mounted from the start, so new mail notifies from any app. */}
              <div className="desktop-pane" hidden={active !== "mail"}>
                <MailEmbed active={running("mail")} />
              </div>
              {opened.includes("todo") && (
                <div className="desktop-pane" hidden={active !== "todo"}>
                  <Activity mode={running("todo") ? "visible" : "hidden"}>
                    <TodoEmbed />
                  </Activity>
                </div>
              )}
              {opened.includes("notes") && (
                <div className="desktop-pane" hidden={active !== "notes"}>
                  <Activity mode={running("notes") ? "visible" : "hidden"}>
                    <NotesEmbed />
                  </Activity>
                </div>
              )}
            </div>
          </div>
        </DesktopSettingsProvider>
      </AppSwitcherProvider>
    </DesktopProvider>
  )
}

/** The rail; its settings button opens the window at its first page, the account. */
function Rail({
  apps,
  active,
  onSelect,
  texts,
  foot,
}: {
  apps: (SwitchableApp & { id: AppId })[]
  active: AppId
  onSelect: (app: string) => void
  texts: (typeof TEXTS)["en"]
  foot?: ReactNode
}) {
  // The dashboard has no settings of its own: the window opens at the account.
  const settings = useDesktopSettings(active === "dashboard" ? "mail" : active)
  // The apps open the settings with ⌘, themselves; on the dashboard the shell does.
  useEffect(() => {
    if (active !== "dashboard") return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "," || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      settings?.open()
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [active, settings])
  return (
    <AppRail
      home={{ id: "dashboard", name: texts.dashboard, icon: DashboardSquare01Icon }}
      apps={apps}
      upcoming={UPCOMING}
      active={active}
      onSelect={onSelect}
      settingsLabel={texts.title}
      onSettings={() => settings?.open()}
      soonLabel={texts.soon}
      foot={foot}
    />
  )
}
