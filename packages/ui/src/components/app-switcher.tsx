import { createContext, useContext } from "react"
import type { IconSvgElement } from "@hugeicons/react"

export type SwitchableApp = { id: string; name: string; icon: IconSvgElement; shortcut: string }

type AppSwitcherState = {
  apps: SwitchableApp[]
  active: string
  onSelect: (id: string) => void
}

const AppSwitcherContext = createContext<AppSwitcherState | null>(null)

/** Set by the Even desktop app, which holds several apps in one window. */
export const AppSwitcherProvider = AppSwitcherContext.Provider

/**
 * Inside the desktop app, where the rail's settings button opens one window
 * with every app's settings, and signing out happens on the account page.
 */
export const useInDesktop = () => useContext(AppSwitcherContext) !== null

/** The desktop app's apps and how to switch between them; null on the web. */
export const useAppSwitcher = () => useContext(AppSwitcherContext)
