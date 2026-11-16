import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { CalendarEvent } from "@even/mail-core/calendar-types"
import { cn } from "@even/ui/lib/utils"
import { useI18n } from "@/i18n"
import { eventKey } from "@/lib/calendar"
import { addDays, addMinutes, eventSpan, minuteOfDay, minutesBetween, onDay, sameDay } from "@/lib/dates"
import { EventChip } from "@/components/event-chip"

const HOUR_PX = 48
const SNAP = 15
const DAY_MINUTES = 24 * 60
/** The shortest an event is drawn, so a five-minute one can still be pointed at. */
const MIN_DRAWN = 20

type Placed = { event: CalendarEvent; top: number; bottom: number; column: number; columns: number }

/** Events of one day, side by side where they overlap. */
function layoutDay(events: CalendarEvent[], day: Date): Placed[] {
  const next = addDays(day, 1)
  const items = events
    .filter((event) => !event.allDay && onDay(event, day))
    .map((event) => {
      const { start, end } = eventSpan(event)
      const top = start <= day ? 0 : minuteOfDay(start)
      const bottom = end >= next ? DAY_MINUTES : minuteOfDay(end)
      return { event, top, bottom: Math.max(bottom, top + MIN_DRAWN) }
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom)

  const placed: Placed[] = []
  let cluster: Placed[] = []
  let columnsEnd: number[] = []
  let clusterEnd = -1
  const close = () => {
    for (const item of cluster) item.columns = columnsEnd.length
    cluster = []
    columnsEnd = []
  }
  for (const item of items) {
    if (item.top >= clusterEnd) close()
    let column = columnsEnd.findIndex((end) => end <= item.top)
    if (column === -1) column = columnsEnd.push(item.bottom) - 1
    else columnsEnd[column] = item.bottom
    const entry = { ...item, column, columns: 1 }
    cluster.push(entry)
    placed.push(entry)
    clusterEnd = Math.max(clusterEnd, item.bottom)
  }
  close()
  return placed
}

type Drag =
  | { kind: "create"; day: number; anchor: number; current: number }
  | {
      kind: "move"
      event: CalendarEvent
      grab: number
      duration: number
      day: number
      minute: number
      moved: boolean
      originX: number
      originY: number
    }
  | { kind: "resize"; event: CalendarEvent; day: number; start: number; end: number; moved: boolean }

const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function TimeGrid({
  days,
  events,
  color,
  selectedKey,
  onSelect,
  onCreate,
  onReschedule,
  onOpenDay,
}: {
  days: Date[]
  events: CalendarEvent[]
  color: (event: CalendarEvent) => string
  selectedKey: string | null
  onSelect: (event: CalendarEvent) => void
  onCreate: (start: Date, end: Date, allDay: boolean) => void
  onReschedule: (event: CalendarEvent, start: Date, end: Date) => void
  onOpenDay: (day: Date) => void
}) {
  const { t, locale } = useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const now = useNow()

  // Opens at the start of the working day rather than at midnight.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX - 12
  }, [])

  const placed = useMemo(() => days.map((day) => layoutDay(events, day)), [days, events])
  const allDay = useMemo(
    () => days.map((day) => events.filter((event) => event.allDay && onDay(event, day))),
    [days, events]
  )
  const hasAllDay = allDay.some((list) => list.length > 0)

  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" })
  const hour = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })

  /** The day column and minute under the pointer. */
  function pointAt(clientX: number, clientY: number) {
    const rect = columnsRef.current!.getBoundingClientRect()
    const day = clamp(Math.floor(((clientX - rect.left) / rect.width) * days.length), 0, days.length - 1)
    const minute = clamp(((clientY - rect.top) / HOUR_PX) * 60, 0, DAY_MINUTES)
    return { day, minute }
  }

  function startCreate(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const { day, minute } = pointAt(event.clientX, event.clientY)
    const at = clamp(Math.floor(minute / SNAP) * SNAP, 0, DAY_MINUTES - SNAP)
    columnsRef.current!.setPointerCapture(event.pointerId)
    setDrag({ kind: "create", day, anchor: at, current: at })
  }

  function startMove(event: ReactPointerEvent, calendarEvent: CalendarEvent, resize: boolean) {
    if (event.button !== 0) return
    event.stopPropagation()
    columnsRef.current!.setPointerCapture(event.pointerId)
    const { start, end } = eventSpan(calendarEvent)
    const { day, minute } = pointAt(event.clientX, event.clientY)
    const dayStart = days[day]!
    const startMinute = minutesBetween(dayStart, start)
    if (resize) {
      setDrag({ kind: "resize", event: calendarEvent, day, start: startMinute, end: minutesBetween(dayStart, end), moved: false })
      return
    }
    setDrag({
      kind: "move",
      event: calendarEvent,
      grab: minute - startMinute,
      duration: minutesBetween(start, end),
      day,
      minute: startMinute,
      moved: false,
      originX: event.clientX,
      originY: event.clientY,
    })
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!drag) return
    const { day, minute } = pointAt(event.clientX, event.clientY)
    if (drag.kind === "create") setDrag({ ...drag, current: clamp(snap(minute), 0, DAY_MINUTES) })
    else if (drag.kind === "resize")
      setDrag({ ...drag, end: Math.max(drag.start + SNAP, snap(minute)), moved: true })
    else {
      const moved = drag.moved || Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) > 4
      if (!moved) return
      setDrag({ ...drag, day, minute: clamp(snap(minute - drag.grab), 0, DAY_MINUTES - SNAP), moved })
    }
  }

  function onPointerUp() {
    if (!drag) return
    setDrag(null)
    if (drag.kind === "create") {
      const from = Math.min(drag.anchor, drag.current)
      const to = Math.max(drag.anchor, drag.current)
      const day = days[drag.day]!
      // A click asks for an hour; a drag for what was drawn.
      onCreate(addMinutes(day, from), addMinutes(day, to - from >= SNAP ? to : from + 60), false)
      return
    }
    if (!drag.moved) {
      onSelect(drag.event)
      return
    }
    if (drag.kind === "resize") {
      const day = days[drag.day]!
      onReschedule(drag.event, addMinutes(day, drag.start), addMinutes(day, drag.end))
      return
    }
    const start = addMinutes(days[drag.day]!, drag.minute)
    if (start.getTime() !== eventSpan(drag.event).start.getTime())
      onReschedule(drag.event, start, addMinutes(start, drag.duration))
  }

  /** Where the dragged event is drawn while it moves. */
  function ghost(dayIndex: number) {
    if (!drag) return null
    if (drag.kind === "create") {
      if (drag.day !== dayIndex) return null
      const from = Math.min(drag.anchor, drag.current)
      const to = Math.max(drag.anchor, drag.current, from + SNAP)
      return <div className="plan-ghost" style={{ top: (from / 60) * HOUR_PX, height: ((to - from) / 60) * HOUR_PX }} />
    }
    if (!drag.moved || drag.day !== dayIndex) return null
    const from = drag.kind === "move" ? drag.minute : drag.start
    const to = drag.kind === "move" ? drag.minute + drag.duration : drag.end
    const day = days[dayIndex]!
    const height = ((Math.min(to, DAY_MINUTES) - from) / 60) * HOUR_PX
    return (
      <div
        className={cn("plan-event is-dragging", height < 34 && "is-short")}
        style={{
          top: (from / 60) * HOUR_PX,
          height: Math.max(height - 2, 18),
          left: 0,
          width: "100%",
          ["--event" as string]: color(drag.event),
        }}
      >
        <EventChip
          event={drag.event}
          time={`${hour.format(addMinutes(day, from))} – ${hour.format(addMinutes(day, to))}`}
        />
      </div>
    )
  }

  const dragging = drag && drag.kind !== "create" && drag.moved ? eventKey(drag.event) : null
  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }

  return (
    <div className="plan-grid">
      <div className="plan-grid-head">
        <div className="plan-gutter" />
        <div className="plan-grid-days-head" style={columns}>
          {days.map((day) => (
            <button
              key={day.toISOString()}
              type="button"
              className={cn("plan-day-head", sameDay(day, now) && "is-today")}
              onClick={() => onOpenDay(day)}
            >
              <span className="plan-day-name">{weekday.format(day)}</span>
              <span className="plan-day-number">{day.getDate()}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={cn("plan-allday", !hasAllDay && "is-empty")}>
        <div className="plan-gutter plan-allday-label">{t.shell.allDay}</div>
        <div className="plan-grid-days-head" style={columns}>
          {days.map((day, index) => (
            <div
              key={day.toISOString()}
              className="plan-allday-cell"
              onDoubleClick={(event) => {
                if (event.target === event.currentTarget) onCreate(day, addDays(day, 1), true)
              }}
            >
              {allDay[index]!.map((event) => (
                <button
                  key={eventKey(event)}
                  type="button"
                  className={cn("plan-chip", selectedKey === eventKey(event) && "is-selected", stateClass(event))}
                  style={{ ["--event" as string]: color(event) }}
                  onClick={() => onSelect(event)}
                >
                  <span className="truncate">{event.title || t.shell.noTitle}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div ref={scroller} className="plan-scroll">
        <div className="plan-grid-body" style={{ height: 24 * HOUR_PX }}>
          <div className="plan-gutter plan-hours">
            {Array.from({ length: 23 }, (_, index) => (
              <span key={index} style={{ top: (index + 1) * HOUR_PX }}>
                {hour.format(new Date(2000, 0, 1, index + 1))}
              </span>
            ))}
          </div>
          <div
            ref={columnsRef}
            className="plan-columns"
            style={columns}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {days.map((day, dayIndex) => (
              <div key={day.toISOString()} className="plan-column" onPointerDown={startCreate}>
                {placed[dayIndex]!.map(({ event, top, bottom, column, columns: count }) => {
                  const key = eventKey(event)
                  const { start, end } = eventSpan(event)
                  const height = ((bottom - top) / 60) * HOUR_PX
                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "plan-event",
                        selectedKey === key && "is-selected",
                        dragging === key && "is-source",
                        height < 34 && "is-short",
                        event.canEdit && "is-editable",
                        stateClass(event)
                      )}
                      style={{
                        top: (top / 60) * HOUR_PX,
                        height: height - 2,
                        left: `calc(${(column / count) * 100}% + 1px)`,
                        width: `calc(${(1 / count) * 100}% - 3px)`,
                        ["--event" as string]: color(event),
                      }}
                      onPointerDown={(pointer) =>
                        event.canEdit ? startMove(pointer, event, false) : pointer.stopPropagation()
                      }
                      onClick={() => {
                        if (!event.canEdit) onSelect(event)
                      }}
                      onKeyDown={(key) => {
                        if (key.key === "Enter" || key.key === " ") {
                          key.preventDefault()
                          onSelect(event)
                        }
                      }}
                    >
                      <EventChip event={event} time={`${hour.format(start)} – ${hour.format(end)}`} />
                      {event.canEdit && (
                        <span
                          className="plan-event-resize"
                          aria-hidden="true"
                          onPointerDown={(pointer) => startMove(pointer, event, true)}
                        />
                      )}
                    </div>
                  )
                })}
                {ghost(dayIndex)}
                {sameDay(day, now) && (
                  <div className="plan-now" style={{ top: (minuteOfDay(now) / 60) * HOUR_PX }} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** How an invitation looks before and after answering it. */
export const stateClass = (event: CalendarEvent) =>
  event.myResponse === "needsAction"
    ? "is-pending"
    : event.myResponse === "declined"
      ? "is-declined"
      : event.myResponse === "tentative"
        ? "is-tentative"
        : event.free
          ? "is-free"
          : undefined

/** The time, again every minute, for the line that marks now. */
export function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
