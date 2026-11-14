import { createContext, useContext } from "react"
import type { IconSvgElement } from "@hugeicons/react"

export type SwitchableApp = { id: string; name: string; icon: IconSvgElement; shortcut: string }

type AppSwitcherState = {
  apps: SwitchableApp[]
  active: string
  onSelect: (id: string) => void
  /**
   * On the web each app has a path of its own ("/mail", "/todo"), and the app in
   * front owns the browser's address. The desktop app has no address and leaves this out.
   */
  paths?: Record<string, string>
}

const AppSwitcherContext = createContext<AppSwitcherState | null>(null)

/** Set by the Even shell (the desktop app, and app.jornboerema.nl), which holds several apps in one window. */
export const AppSwitcherProvider = AppSwitcherContext.Provider

/**
 * Inside the Even shell, on the desktop and on the web, where the rail's settings button opens one window
 * with every app's settings, and signing out happens on the account page.
 */
export const useInDesktop = () => useContext(AppSwitcherContext) !== null

/** The desktop app's apps and how to switch between them; null on the web. */
export const useAppSwitcher = () => useContext(AppSwitcherContext)
