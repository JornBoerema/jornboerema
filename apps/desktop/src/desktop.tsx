import { Activity, useEffect, useState } from "react"
import { CheckmarkSquare02Icon, Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { MailEmbed } from "@evido/mail-web/embed"
import { authClient, TodoEmbed, TodoSignIn } from "@evido/todo-web/embed"
import { Toaster } from "@evido/ui/components/sonner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@evido/ui/components/tooltip"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { cn } from "@evido/ui/lib/utils"
import { Brand } from "./brand"

type AppId = "mail" | "todo"

/** In rail order; ⌘1, ⌘2, … follow it. Even chatten and Even inloggen join later. */
const APPS: { id: AppId; name: string; icon: IconSvgElement }[] = [
  { id: "mail", name: "Even mailen", icon: Mail01Icon },
  { id: "todo", name: "Even doen", icon: CheckmarkSquare02Icon },
]

const APP_KEY = "even.desktop.app"
const isMac = navigator.userAgent.includes("Mac")

function storedApp(): AppId {
  try {
    const stored = localStorage.getItem(APP_KEY)
    if (APPS.some((app) => app.id === stored)) return stored as AppId
  } catch {
    // No storage: start with the first app.
  }
  return APPS[0].id
}

function Rail({ active, onSelect }: { active: AppId; onSelect: (app: AppId) => void }) {
  return (
    <nav className="app-rail" aria-label="Apps">
      <div className="app-rail-drag" data-tauri-drag-region />
      {APPS.map((app, index) => (
        <Tooltip key={app.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn("app-rail-button", app.id === active && "active")}
              aria-label={app.name}
              aria-current={app.id === active ? "page" : undefined}
              onClick={() => onSelect(app.id)}
            >
              <HugeiconsIcon icon={app.icon} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {app.name}
            <kbd className="tip-kbd">{isMac ? `⌘${index + 1}` : `Ctrl+${index + 1}`}</kbd>
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  )
}

function Apps() {
  const [active, setActive] = useState(storedApp)
  // An app mounts the first time it is opened and then stays, hidden, so it
  // keeps its place; while hidden its effects (shortcuts, live updates) stop.
  const [opened, setOpened] = useState<AppId[]>(() => [active])

  const select = (app: AppId) => {
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
    <div className={cn("desktop-shell", isMac && "mac")}>
      <TooltipProvider delayDuration={150}>
        <Rail active={active} onSelect={select} />
      </TooltipProvider>
      <div className="desktop-app">
        {opened.includes("mail") && (
          <Activity mode={active === "mail" ? "visible" : "hidden"}>
            <MailEmbed />
          </Activity>
        )}
        {opened.includes("todo") && (
          <Activity mode={active === "todo" ? "visible" : "hidden"}>
            <TodoEmbed />
          </Activity>
        )}
      </div>
    </div>
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
  return (
    <ThemeProvider>
      <Gate />
      <Toaster position="bottom-right" closeButton />
    </ThemeProvider>
  )
}
