import type { ReactNode } from "react"
import { cn } from "@even/ui/lib/utils"
import { useI18n } from "@/admin/i18n"
import { useFormat } from "@/admin/lib/format"

/** A headline number with a small line under it. */
export function Stat({ label, value, detail, className }: { label: string; value: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-2xl border bg-card p-4", className)}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
    </div>
  )
}

/** "+12%" against the period before, in plain ink: up isn't always good. */
export function Change({ now, before }: { now: number; before: number }) {
  const t = useI18n().t.overview
  const { percent } = useFormat()
  if (now === before) return <>{t.noChange}</>
  if (!before) return <>{t.vsPrevious(`+${now}`)}</>
  const change = (now - before) / before
  return <>{t.vsPrevious(`${change > 0 ? "+" : "−"}${percent(Math.abs(change))}`)}</>
}

/** A ranked list with thin bars behind the values: top pages, referrers, countries. */
export function TopList({
  title,
  rows,
  empty,
  total,
}: {
  title: string
  rows: { key: string; label: ReactNode; value: number }[]
  empty: string
  total?: number
}) {
  const { number } = useFormat()
  const max = total ?? Math.max(1, ...rows.map((row) => row.value))
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="px-1 text-sm font-medium">{title}</h2>
      <div className="rounded-2xl border bg-card p-2">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {rows.map((row) => (
              <li key={row.key} className="relative flex items-center gap-3 overflow-hidden rounded-lg px-2.5 py-1.5 text-sm">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 rounded-lg bg-primary/10"
                  style={{ width: `${(row.value / max) * 100}%` }}
                />
                <span className="relative min-w-0 flex-1 truncate">{row.label}</span>
                <span className="relative shrink-0 text-muted-foreground tabular-nums">{number(row.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  )
}
