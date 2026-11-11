import { createContext, useContext, type ReactNode } from "react"
import { Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"

export type SwitchableApp = { id: string; name: string; icon: IconSvgElement; shortcut: string }

type AppSwitcherState = { apps: SwitchableApp[]; active: string; onSelect: (id: string) => void }

const AppSwitcherContext = createContext<AppSwitcherState | null>(null)

/** Set by the Even desktop app, which holds several apps in one window. */
export const AppSwitcherProvider = AppSwitcherContext.Provider

/**
 * An app's brand. Inside the desktop app it opens a menu to switch to another
 * app; on the web, where each app has its own address, it stays plain.
 */
export function AppSwitcher({ children }: { children: ReactNode }) {
  const switcher = useContext(AppSwitcherContext)
  if (!switcher) return children
  const active = switcher.apps.find((app) => app.id === switcher.active)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="app-switcher" aria-label={active?.name}>
          {children}
          <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} aria-hidden="true" className="app-switcher-chevron" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-52">
        {switcher.apps.map((app) => (
          <DropdownMenuItem key={app.id} onSelect={() => switcher.onSelect(app.id)}>
            <HugeiconsIcon icon={app.icon} strokeWidth={2} aria-hidden="true" />
            <span className="flex-1">{app.name}</span>
            {app.id === switcher.active ? (
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} aria-hidden="true" className="text-primary" />
            ) : (
              <DropdownMenuShortcut>{app.shortcut}</DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
