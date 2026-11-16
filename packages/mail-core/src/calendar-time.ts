/** Whether the runtime knows this IANA time zone name. */
export function isTimeZone(name: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name })
    return true
  } catch {
    return false
  }
}

/** How far `timeZone` is ahead of UTC at this instant, in milliseconds. */
function offsetAt(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs))
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** "2026-11-16T09:30:00" on the clock in `timeZone` as an instant. */
export function wallTimeToInstant(wall: string, timeZone: string): Date {
  const [date, clock = "00:00:00"] = wall.split("T")
  const [year, month, day] = date!.split("-").map(Number)
  const [hour, minute, second] = clock.split(":").map((value) => Number.parseFloat(value) || 0)
  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!, Math.floor(second!))
  // Twice, so a wall time near a daylight-saving change lands on the right side.
  const first = guess - offsetAt(guess, timeZone)
  return new Date(guess - offsetAt(first, timeZone))
}
