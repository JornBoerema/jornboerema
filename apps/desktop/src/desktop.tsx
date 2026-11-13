import { Activity, useEffect, useState } from "react"
import {
  BubbleChatIcon,
  Calendar03Icon,
  CheckmarkSquare02Icon,
  Clock01Icon,
  Mail01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { MailEmbed } from "@evido/mail-web/embed"
import { authClient, TodoEmbed, TodoSettingsNav } from "@evido/todo-web/embed"
import { NotesEmbed } from "@evido/notes-web/embed"
import { Toaster } from "@evido/ui/components/sonner"
import { AppSwitcherProvider, type SwitchableApp } from "@evido/ui/components/app-switcher"
import { DesktopSettingsProvider, useDesktopSettings } from "@evido/ui/components/desktop-settings"
import { useCurrentLanguage } from "@evido/i18n/react"
import { DesktopProvider } from "@evido/ui/components/desktop-app"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { cn } from "@evido/ui/lib/utils"
import { forgetMailOnDisk } from "./mail-storage"
import { AppRail } from "./rail"
import { SignIn } from "./sign-in"
import { hideSplash } from "./splash"
import { useDesktopApp } from "./updates"
import { useWindowDragging } from "./window"

type AppId = "mail" | "todo" | "notes"

const isMac = navigator.userAgent.includes("Mac")

/** In rail order; ⌘1, ⌘2, … follow it. */
const APP_LIST: { id: AppId; name: string; icon: IconSvgElement }[] = [
  { id: "mail", name: "Even mailen", icon: Mail01Icon },
  { id: "todo", name: "Even doen", icon: CheckmarkSquare02Icon },
  { id: "notes", name: "Even noteren", icon: Note01Icon },
]
/** Shown in the rail, greyed out, until they join APP_LIST. */
const UPCOMING = [
  { id: "plan", name: "Even plannen", icon: Calendar03Icon },
  { id: "hours", name: "Even uren", icon: Clock01Icon },
  { id: "chat", name: "Even chatten", icon: BubbleChatIcon },
]
const APPS: (SwitchableApp & { id: AppId })[] = APP_LIST.map((app, index) => ({
  ...app,
  shortcut: isMac ? `⌘${index + 1}` : `Ctrl+${index + 1}`,
}))

const APP_KEY = "even.desktop.app"

/** The settings window's own words; the pages in it come from the apps, in their language. */
const SETTINGS_TEXTS = {
  en: {
    title: "Settings",
    description: "Settings for every Even app.",
    search: "Search",
    noResults: "No settings found.",
    close: "Close",
  },
  nl: {
    title: "Instellingen",
    description: "Instellingen van alle Even-apps.",
    search: "Zoeken",
    noResults: "Geen instellingen gevonden.",
    close: "Sluiten",
  },
}

const isAppId = (value: unknown): value is AppId => APPS.some((app) => app.id === value)

function storedApp(): AppId {
  try {
    const stored = localStorage.getItem(APP_KEY)
    if (isAppId(stored)) return stored
  } catch {
    // No storage: start with the first app.
  }
  return APPS[0].id
}

function Apps() {
  const desktop = useDesktopApp()
  const language = useCurrentLanguage()
  const texts = SETTINGS_TEXTS[language] ?? SETTINGS_TEXTS.en
  const [active, setActive] = useState(storedApp)
  // An app mounts the first time it is opened and then stays, hidden, so it
  // keeps its place; while hidden its effects (shortcuts, live updates) stop.
  const [opened, setOpened] = useState<AppId[]>(() => [active, "mail"])
  // The settings hold every app's pages, so while they are open every app runs.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettingsWindow = (open: boolean) => {
    if (open) setOpened(APPS.map((app) => app.id))
    setSettingsOpen(open)
  }

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

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return
      const app = APPS[Number(event.key) - 1]
      if (!app) return
      event.preventDefault()
      select(app.id)
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [])

  const running = (app: AppId) => active === app || settingsOpen

  return (
    <DesktopProvider value={desktop}>
      <AppSwitcherProvider value={{ apps: APPS, active, onSelect: select }}>
        <DesktopSettingsProvider
          apps={APPS}
          open={settingsOpen}
          onOpenChange={openSettingsWindow}
          labels={texts}
        >
          {/* Even doen's pages are in the settings from the start, not only once it runs. */}
          <TodoSettingsNav />
          <div className={cn("desktop-app", isMac && "mac")}>
            <Rail active={active} onSelect={select} settingsLabel={texts.title} />
            <div className="desktop-stage">
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
function Rail({ active, onSelect, settingsLabel }: { active: AppId; onSelect: (app: string) => void; settingsLabel: string }) {
  const settings = useDesktopSettings(active)
  return (
    <AppRail
      apps={APPS}
      upcoming={UPCOMING}
      active={active}
      onSelect={onSelect}
      settingsLabel={settingsLabel}
      onSettings={() => settings?.open()}
    />
  )
}

function Gate() {
  const { data, isPending, error } = authClient.useSession()
  // Only when the API says there is no session; offline, the cache is what shows.
  const signedOut = !isPending && !data && !error
  useEffect(() => {
    if (signedOut) void forgetMailOnDisk()
  }, [signedOut])
  useEffect(() => {
    if (!isPending) hideSplash()
  }, [isPending])
  if (isPending) return <div className="desktop-loading" data-tauri-drag-region />
  if (!data) return <SignIn mac={isMac} />
  return <Apps />
}

export function Desktop() {
  useWindowDragging()
  return (
    <ThemeProvider>
      <Gate />
      <Toaster position="bottom-right" closeButton />
    </ThemeProvider>
  )
}
