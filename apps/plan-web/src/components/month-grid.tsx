import { useMemo } from "react"
import type { CalendarEvent } from "@even/mail-core/calendar-types"
import { cn } from "@even/ui/lib/utils"
import { useI18n } from "@/i18n"
import { eventKey } from "@/lib/calendar"
import { addMinutes, eventSpan, onDay, sameDay } from "@/lib/dates"
import { stateClass, useNow } from "@/components/time-grid"

/** Events a day cell lists before "3 more". */
const SHOWN = 3

/** Six weeks, Monday first, with the events of each day. */
export function MonthGrid({
  days,
  month,
  events,
  color,
  selectedKey,
  onSelect,
  onCreate,
  onOpenDay,
}: {
  days: Date[]
  /** The month in view; days around it are quieter. */
  month: number
  events: CalendarEvent[]
  color: (event: CalendarEvent) => string
  selectedKey: string | null
  onSelect: (event: CalendarEvent) => void
  onCreate: (start: Date, end: Date, allDay: boolean) => void
  onOpenDay: (day: Date) => void
}) {
  const { t, locale } = useI18n()
  const now = useNow()
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" })
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })
  const perDay = useMemo(
    () =>
      days.map((day) =>
        events
          .filter((event) => onDay(event, day))
          // All-day first, then by time.
          .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
      ),
    [days, events]
  )

  return (
    <div className="plan-month">
      <div className="plan-month-head">
        {days.slice(0, 7).map((day) => (
          <span key={day.getDay()}>{weekday.format(day)}</span>
        ))}
      </div>
      <div className="plan-month-body">
        {days.map((day, index) => {
          const list = perDay[index]!
          const hidden = list.length - SHOWN
          return (
            <div
              key={day.toISOString()}
              className={cn("plan-month-cell", day.getMonth() !== month && "is-outside", sameDay(day, now) && "is-today")}
              onDoubleClick={(event) => {
                if (event.target === event.currentTarget) onCreate(addMinutes(day, 9 * 60), addMinutes(day, 10 * 60), false)
              }}
            >
              <button
                type="button"
                className={cn("plan-month-date", sameDay(day, now) && "is-today")}
                onClick={() => onOpenDay(day)}
              >
                {day.getDate()}
              </button>
              {list.slice(0, hidden > 0 ? SHOWN - 1 : SHOWN).map((event) => (
                <button
                  key={eventKey(event)}
                  type="button"
                  className={cn(
                    "plan-chip",
                    !event.allDay && "is-timed",
                    selectedKey === eventKey(event) && "is-selected",
                    stateClass(event)
                  )}
                  style={{ ["--event" as string]: color(event) }}
                  onClick={() => onSelect(event)}
                >
                  {!event.allDay && <span className="plan-chip-time">{time.format(eventSpan(event).start)}</span>}
                  <span className="truncate">{event.title || t.shell.noTitle}</span>
                </button>
              ))}
              {hidden > 0 && (
                <button type="button" className="plan-month-more" onClick={() => onOpenDay(day)}>
                  {t.shell.more(hidden + 1)}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
