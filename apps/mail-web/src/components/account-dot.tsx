import { cn } from "@evido/ui/lib/utils"
import { MAIL_ACCOUNT_COLORS } from "@evido/mail-core/types"

/** Same lightness and strength, so no mailbox shouts louder than another in either theme. */
export const ACCOUNT_COLORS = [
  "oklch(0.66 0.15 250)",
  "oklch(0.76 0.16 75)",
  "oklch(0.68 0.19 355)",
  "oklch(0.69 0.16 155)",
  "oklch(0.64 0.17 300)",
  "oklch(0.72 0.12 200)",
  "oklch(0.63 0.2 28)",
  "oklch(0.65 0.02 260)",
] as const

/** Colour alone can't identify a mailbox, so pass `label` wherever the dot stands by itself. */
export function AccountDot({
  color,
  label,
  className,
}: {
  color: number
  label?: string
  className?: string
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: ACCOUNT_COLORS[color % MAIL_ACCOUNT_COLORS] }}
    />
  )
}
