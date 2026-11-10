import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@evido/ui/components/tooltip"

/**
 * The name of an icon-only control, and its shortcut, in the shared tooltip.
 * Every icon button in the app uses this instead of the browser's own title.
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
