import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Settings01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@evido/ui/components/dropdown-menu"

export type SwitchableApp = { id: string; name: string; icon: IconSvgElement; shortcut: string }

type AppSwitcherState = {
  apps: SwitchableApp[]
  active: string
  onSelect: (id: string) => void
  /** The place at the bottom of the desktop app's rail for the open app's menu. */
  menuSlot: HTMLElement | null
}

const AppSwitcherContext = createContext<AppSwitcherState | null>(null)

/** Set by the Even desktop app, which holds several apps in one window. */
export const AppSwitcherProvider = AppSwitcherContext.Provider

/**
 * Inside the desktop app, where the rail's settings button holds what the
 * account menu at the bottom of the sidebar does on the web.
 */
export const useInDesktop = () => useContext(AppSwitcherContext) !== null

/**
 * An app's own menu (settings, shortcuts, signing out) behind the settings
 * button at the bottom of the desktop app's rail, while that app is open.
 * Rendered from inside the app, so its items keep the app's providers. On the
 * web, where the sidebar's account menu holds these, it renders nothing.
 */
export function DesktopAppMenu({ app, label, children }: { app: string; label: string; children: ReactNode }) {
  const switcher = useContext(AppSwitcherContext)
  if (!switcher?.menuSlot || switcher.active !== app) return null
  return createPortal(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="app-rail-button" aria-label={label}>
          <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={10} className="min-w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>,
    switcher.menuSlot
  )
}
