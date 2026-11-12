import type { ReactNode } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

/**
 * An empty list: the place's sign, what is (not) here and, if useful, one line on
 * why. Centred in the list's column, a little above the middle, where the eye lands.
 */
export function ListEmpty({ icon, title, children }: { icon: IconSvgElement; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-8 pb-[12vh] text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <HugeiconsIcon icon={icon} strokeWidth={1.75} className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <p className="max-w-64 text-sm text-balance text-muted-foreground">{children}</p>}
    </div>
  )
}
