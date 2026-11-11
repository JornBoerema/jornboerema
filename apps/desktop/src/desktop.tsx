import { Activity, useEffect, useState } from "react"
import { CheckmarkSquare02Icon, Mail01Icon } from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { MailEmbed } from "@evido/mail-web/embed"
import { authClient, TodoEmbed, TodoSignIn } from "@evido/todo-web/embed"
import { Toaster } from "@evido/ui/components/sonner"
import { AppSwitcherProvider, type SwitchableApp } from "@evido/ui/components/app-switcher"
import { DesktopProvider } from "@evido/ui/components/desktop-app"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { cn } from "@evido/ui/lib/utils"
import { Brand } from "./brand"
import { useDesktopApp } from "./updates"
import { useWindowDragging } from "./window"

type AppId = "mail" | "todo"

const isMac = navigator.userAgent.includes("Mac")

/** In menu order; ⌘1, ⌘2, … follow it. Even chatten and Even inloggen join later. */
const APP_LIST: { id: AppId; name: string; icon: IconSvgElement }[] = [
  { id: "mail", name: "Even mailen", icon: Mail01Icon },
  { id: "todo", name: "Even doen", icon: CheckmarkSquare02Icon },
]
const APPS: (SwitchableApp & { id: AppId })[] = APP_LIST.map((app, index) => ({
  ...app,
  shortcut: isMac ? `⌘${index + 1}` : `Ctrl+${index + 1}`,
}))

const APP_KEY = "even.desktop.app"

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
  const [active, setActive] = useState(storedApp)
  // An app mounts the first time it is opened and then stays, hidden, so it
  // keeps its place; while hidden its effects (shortcuts, live updates) stop.
  const [opened, setOpened] = useState<AppId[]>(() => [active, "mail"])

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

  return (
    <DesktopProvider value={desktop}>
      <AppSwitcherProvider value={{ apps: APPS, active, onSelect: select }}>
        <div className={cn("desktop-app", isMac && "mac")}>
          {/* Mail stays mounted from the start, so new mail notifies from any app. */}
          <MailEmbed active={active === "mail"} />
          {opened.includes("todo") && (
            <Activity mode={active === "todo" ? "visible" : "hidden"}>
              <TodoEmbed />
            </Activity>
          )}
        </div>
      </AppSwitcherProvider>
    </DesktopProvider>
  )
}

function Gate() {
  const { data, isPending } = authClient.useSession()
  if (isPending) return <div className="desktop-loading" data-tauri-drag-region />
  if (!data)
    return (
      <div className={cn("desktop-sign-in", isMac && "mac")}>
        <TodoSignIn brand={<Brand />} />
      </div>
    )
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
