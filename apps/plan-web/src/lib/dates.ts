import type { CalendarEvent } from "@even/mail-core/calendar-types"

/** Everything here is in the device's own time zone. */
export const DAY_MS = 24 * 60 * 60 * 1000

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

export function startOfDay(date: Date) {
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  return day
}

export function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** Weeks start on Monday. */
export function startOfWeek(date: Date) {
  const day = startOfDay(date)
  return addDays(day, -((day.getDay() + 6) % 7))
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date: Date, months: number) {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1)
  // Keep the day where the month has it (31 January → 28 February).
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(date.getDate(), last))
  return next
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const pad = (value: number) => String(value).padStart(2, "0")

/** "2026-11-16" for the local day. */
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Local midnight of "2026-11-16". */
export function fromDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number)
  return new Date(year!, month! - 1, day!)
}

/** "09:30" */
export const clockKey = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** "2026-11-16T09:30", the wall time the API takes. */
export const wallTime = (date: Date) => `${dayKey(date)}T${clockKey(date)}`

/** From "2026-11-16" and "09:30" back to a local instant. */
export function fromParts(day: string, clock: string) {
  const date = fromDayKey(day)
  const [hours, minutes] = clock.split(":").map(Number)
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return date
}

/** When an event starts and ends on this device's clock; all-day ones run midnight to midnight. */
export function eventSpan(event: Pick<CalendarEvent, "start" | "end" | "allDay">) {
  if (event.allDay) return { start: fromDayKey(event.start), end: fromDayKey(event.end) }
  return { start: new Date(event.start), end: new Date(event.end) }
}

/** Whether the event touches the local day that starts at `day`. */
export function onDay(event: CalendarEvent, day: Date) {
  const { start, end } = eventSpan(event)
  const next = addDays(day, 1)
  // An event of no length still shows on its day.
  return start < next && (end > day || (end.getTime() === start.getTime() && start >= day))
}

/** Minutes since midnight. */
export const minuteOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes()

export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000)

export type ViewKind = "day" | "week" | "month"

/** The days a view shows around `date`, and the stretch to read events for. */
export function viewDays(kind: ViewKind, date: Date) {
  if (kind === "day") return [startOfDay(date)]
  if (kind === "week") {
    const first = startOfWeek(date)
    return Array.from({ length: 7 }, (_, index) => addDays(first, index))
  }
  const first = startOfWeek(startOfMonth(date))
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

export function stepView(kind: ViewKind, date: Date, direction: 1 | -1) {
  if (kind === "day") return addDays(date, direction)
  if (kind === "week") return addDays(date, 7 * direction)
  return addMonths(date, direction)
}
