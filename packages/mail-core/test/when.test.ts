import { describe, expect, it } from "vitest"
import { parseWhen } from "../src/when"

// Wednesday 11 November 2026, 15:00 local time.
const now = new Date(2026, 10, 11, 15, 0)
const at = (input: string) => {
  const date = parseWhen(input, now)
  if (!date) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

describe("parseWhen", () => {
  it.each([
    ["morgen 10 uur", "2026-11-12 10:00"],
    ["morgen", "2026-11-12 08:00"],
    ["morgenavond", "2026-11-12 20:00"],
    ["morgen om half 3", "2026-11-12 14:30"],
    ["overmorgen 9:30", "2026-11-13 09:30"],
    ["over 2 weken", "2026-11-25 08:00"],
    ["over 3 dagen", "2026-11-14 08:00"],
    ["over een uur", "2026-11-11 16:00"],
    ["over 30 minuten", "2026-11-11 15:30"],
    ["vrijdag", "2026-11-13 08:00"],
    ["vrijdag 16:00", "2026-11-13 16:00"],
    ["volgende week", "2026-11-16 08:00"],
    ["volgende week vrijdag", "2026-11-20 08:00"],
    ["dit weekend", "2026-11-14 08:00"],
    ["vanavond", "2026-11-11 20:00"],
    ["17 uur", "2026-11-11 17:00"],
    ["9 uur", "2026-11-12 09:00"],
    ["kwart over 4", "2026-11-11 16:15"],
    ["12 december", "2026-12-12 08:00"],
    ["3 januari 14:00", "2027-01-03 14:00"],
    ["1/12", "2026-12-01 08:00"],
    ["tomorrow 10am", "2026-11-12 10:00"],
    ["in 2 weeks", "2026-11-25 08:00"],
    ["next friday at 9", "2026-11-13 09:00"],
    ["tonight", "2026-11-11 20:00"],
    ["in an hour", "2026-11-11 16:00"],
  ])("%s → %s", (input, expected) => expect(at(input)).toBe(expected))

  it.each(["", "gisteren", "banaan", "vandaag 9 uur", "31 februari"])("no moment in %j", (input) => {
    expect(at(input)).toBeNull()
  })
})
