import type { ReactNode } from "react"
import { Settings01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { UpdateButton } from "@evido/ui/components/desktop-app"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@evido/ui/components/tooltip"
import { cn } from "@evido/ui/lib/utils"

const isMac = navigator.userAgent.includes("Mac")

export type RailApp = { id: string; name: string; icon: IconSvgElement; shortcut?: string }

/**
 * The strip along the left of the window with every Even app; on a phone it lies
 * along the bottom. In the desktop app on macOS the window buttons sit at its top.
 * At its foot "restart to update" (once a new version is ready), whatever the
 * holder adds (`foot`), and the settings of every app. Apps still to come show
 * greyed out.
 */
export function AppRail({
  apps,
  upcoming,
  active,
  onSelect,
  settingsLabel,
  onSettings,
  soonLabel,
  foot,
}: {
  apps: RailApp[]
  upcoming: RailApp[]
  active: string
  onSelect: (id: string) => void
  settingsLabel: string
  onSettings: () => void
  /** "Coming soon", in the app's language. */
  soonLabel: string
  foot?: ReactNode
}) {
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={400}>
      <nav className="app-rail" aria-label="Apps">
        <div className="app-rail-apps">
          {apps.map((app) => (
            <RailButton
              key={app.id}
              app={app}
              selected={app.id === active}
              onClick={() => onSelect(app.id)}
            />
          ))}
          {upcoming.map((app) => (
            <RailButton key={app.id} app={app} upcoming soonLabel={soonLabel} />
          ))}
        </div>
        <div className="app-rail-foot">
          <UpdateButton />
          {foot}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="app-rail-button" aria-label={settingsLabel} aria-keyshortcuts="Meta+Comma Control+Comma" onClick={onSettings}>
                <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              <span>{settingsLabel}</span>
              <span className="app-rail-hint">{isMac ? "⌘," : "Ctrl+,"}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </TooltipProvider>
  )
}

function RailButton({
  app,
  selected = false,
  upcoming = false,
  soonLabel = "",
  onClick,
}: {
  app: RailApp
  selected?: boolean
  upcoming?: boolean
  soonLabel?: string
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn("app-rail-button", selected && "is-selected", upcoming && "is-upcoming")}
          aria-label={upcoming ? `${app.name}, ${soonLabel}` : app.name}
          aria-current={selected ? "page" : undefined}
          // Not `disabled`: the tooltip still says what is coming.
          aria-disabled={upcoming || undefined}
          onClick={upcoming ? undefined : onClick}
        >
          <HugeiconsIcon icon={app.icon} strokeWidth={selected ? 2 : 1.75} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        <span>{app.name}</span>
        {upcoming ? (
          <span className="app-rail-hint">{soonLabel}</span>
        ) : (
          app.shortcut && <span className="app-rail-hint">{app.shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
