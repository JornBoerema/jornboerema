import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@evido/ui/components/tooltip"

/**
 * How long a pointer rests on a control before its name shows: long enough that
 * passing over buttons shows nothing, short enough for someone looking for it.
 * Once one shows, its neighbours show at once.
 */
export const TIP_DELAY_MS = 600

/**
 * The name of an icon-only control, and its shortcut, in the shared tooltip.
 * Only where the icon alone doesn't say it, or to teach a shortcut; obvious
 * icons (copy, close, bin, paperclip, bold) go without, with an aria-label.
 */
export function IconTip({
  label,
  shortcut,
  side = "top",
  children,
}: {
  label: string
  shortcut?: string
  side?: "top" | "right" | "bottom" | "left"
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={side === "right" ? 10 : 6}>
        {label}
        {shortcut && <kbd className="tip-kbd">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
