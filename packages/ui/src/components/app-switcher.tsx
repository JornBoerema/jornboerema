import { createContext, useContext } from "react"
import { createPortal } from "react-dom"
import { Settings01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

export type SwitchableApp = { id: string; name: string; icon: IconSvgElement; shortcut: string }

type AppSwitcherState = {
  apps: SwitchableApp[]
  active: string
  onSelect: (id: string) => void
  /** The place at the bottom of the desktop app's rail for the open app's settings button. */
  menuSlot: HTMLElement | null
}

const AppSwitcherContext = createContext<AppSwitcherState | null>(null)

/** Set by the Even desktop app, which holds several apps in one window. */
export const AppSwitcherProvider = AppSwitcherContext.Provider

/**
 * Inside the desktop app, where the rail's settings button opens the open
 * app's settings, and signing out happens on their account page.
 */
export const useInDesktop = () => useContext(AppSwitcherContext) !== null

/**
 * The settings button at the bottom of the desktop app's rail: opens the open
 * app's settings. Rendered from inside the app, so it reaches the app's state.
 * On the web, where the sidebar has its own way in, it renders nothing.
 */
export function DesktopSettingsButton({ app, label, onOpen }: { app: string; label: string; onOpen: () => void }) {
  const switcher = useContext(AppSwitcherContext)
  if (!switcher?.menuSlot || switcher.active !== app) return null
  return createPortal(
    <button type="button" className="app-rail-button" aria-label={label} title={label} onClick={onOpen}>
      <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.75} aria-hidden="true" />
    </button>,
    switcher.menuSlot
  )
}
