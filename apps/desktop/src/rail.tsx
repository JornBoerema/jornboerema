import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@evido/ui/components/tooltip"
import { cn } from "@evido/ui/lib/utils"
import { EvenMark } from "./brand"

export type RailApp = { id: string; name: string; icon: IconSvgElement; shortcut?: string }

/**
 * The strip along the left of the window with every Even app. On macOS the
 * window buttons sit at its top. Apps still to come show greyed out.
 */
export function AppRail({
  apps,
  upcoming,
  active,
  onSelect,
}: {
  apps: RailApp[]
  upcoming: RailApp[]
  active: string
  onSelect: (id: string) => void
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
          {upcoming.length > 0 && <span className="app-rail-divider" aria-hidden="true" />}
          {upcoming.map((app) => (
            <RailButton key={app.id} app={app} upcoming />
          ))}
        </div>
        <EvenMark className="app-rail-mark" />
      </nav>
    </TooltipProvider>
  )
}

function RailButton({
  app,
  selected = false,
  upcoming = false,
  onClick,
}: {
  app: RailApp
  selected?: boolean
  upcoming?: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn("app-rail-button", selected && "is-selected", upcoming && "is-upcoming")}
          aria-label={upcoming ? `${app.name}, coming soon` : app.name}
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
          <span className="app-rail-hint">Coming soon</span>
        ) : (
          app.shortcut && <span className="app-rail-hint">{app.shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
