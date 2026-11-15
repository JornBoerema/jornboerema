import { useMemo, useState } from "react"
import { useFormat } from "@/admin/lib/format"

type Point = { date: string; value: number }

/**
 * One measure per day as bars: thin, rounded at the top, a hover tooltip, a
 * recessive grid with three values. A table beside it for screen readers.
 */
export function BarChart({ points, label, height = 180 }: { points: Point[]; label: string; height?: number }) {
  const { day, number, compact } = useFormat()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map((point) => point.value))
  const top = useMemo(() => niceMax(max), [max])
  const ticks = [top, top / 2, 0]
  const count = points.length
  const labelEvery = Math.ceil(count / 7)
  const active = hover === null ? null : points[hover]

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative flex gap-2">
        <div className="flex flex-col justify-between pb-5 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height }}>
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {compact(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: height - 20 }} aria-hidden="true">
            {ticks.map((tick) => (
              <div key={tick} className="border-t border-border/60 last:border-foreground/20" />
            ))}
          </div>
          <div
            className="relative flex items-end"
            style={{ height: height - 20, gap: count > 60 ? 1 : 2 }}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={label}
          >
            {points.map((point, index) => (
              <div
                key={point.date}
                className="flex h-full min-w-0 flex-1 items-end"
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
              >
                <div
                  className="w-full rounded-t-[4px] bg-primary transition-opacity"
                  style={{
                    height: point.value ? `max(2px, ${(point.value / top) * 100}%)` : 0,
                    opacity: hover === null || hover === index ? 1 : 0.45,
                  }}
                />
              </div>
            ))}
          </div>
          {active && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm"
              style={{ left: `clamp(48px, ${((hover + 0.5) / count) * 100}%, calc(100% - 48px))` }}
            >
              <div className="text-muted-foreground">{day(active.date, true)}</div>
              <div className="font-medium tabular-nums">{number(active.value)}</div>
            </div>
          )}
          <div className="mt-1.5 flex h-3.5 text-[11px] text-muted-foreground" aria-hidden="true">
            {points.map((point, index) => (
              <span key={point.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                {index % labelEvery === 0 && count - index > labelEvery / 2 ? day(point.date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{day(point.date, true)}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function niceMax(value: number) {
  if (value <= 4) return 4
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power
  return 10 * power
}
