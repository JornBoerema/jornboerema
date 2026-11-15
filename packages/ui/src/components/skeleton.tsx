import * as React from "react"
import { cn } from "cn"

/** Tailwind's animate-pulse takes two seconds. */
const PULSE_MS = 2000

/**
 * One beat for every skeleton on the page: each joins the pulse where it is,
 * so one that takes over from another (a page loading in steps) carries on
 * instead of starting over with a flash.
 */
function usePulsePhase() {
  const [delay] = React.useState(() =>
    typeof performance === "undefined" ? 0 : -(performance.now() % PULSE_MS)
  )
  return `${Math.round(delay)}ms`
}

function Skeleton({ className, style, ...props }: React.ComponentProps<"div">) {
  const animationDelay = usePulsePhase()
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      style={{ animationDelay, ...style }}
      {...props}
    />
  )
}

/** A line of text that is still coming: as tall as the text, the bar inside it. */
function SkeletonLine({
  className,
  bar,
}: {
  /** The line's height (its line-height), e.g. "h-[21px]". */
  className?: string
  /** The bar's own size, e.g. "h-3.5 w-32". */
  bar?: string
}) {
  return (
    <div className={cn("flex items-center", className)}>
      <Skeleton className={cn("h-3.5 w-full", bar)} />
    </div>
  )
}

export { Skeleton, SkeletonLine }
