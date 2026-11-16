import { describe, expect, it } from "vitest"
import { wallTimeToInstant } from "../src/calendar-time"
import { hasCalendarScope } from "../src/calendar-types"

describe("wallTimeToInstant", () => {
  it("reads winter and summer time in Amsterdam", () => {
    expect(wallTimeToInstant("2026-11-16T09:30:00", "Europe/Amsterdam").toISOString()).toBe("2026-11-16T08:30:00.000Z")
    expect(wallTimeToInstant("2026-07-01T09:30:00", "Europe/Amsterdam").toISOString()).toBe("2026-07-01T07:30:00.000Z")
  })
  it("lands on the right side of a daylight-saving change", () => {
    expect(wallTimeToInstant("2026-03-29T03:30:00", "Europe/Amsterdam").toISOString()).toBe("2026-03-29T01:30:00.000Z")
    expect(wallTimeToInstant("2026-10-25T04:00:00", "Europe/Amsterdam").toISOString()).toBe("2026-10-25T03:00:00.000Z")
  })
  it("takes fractions of seconds as Graph writes them", () => {
    expect(wallTimeToInstant("2026-11-16T09:30:00.0000000", "UTC").toISOString()).toBe("2026-11-16T09:30:00.000Z")
  })
})

describe("hasCalendarScope", () => {
  it("needs both Google scopes", () => {
    const events = "https://www.googleapis.com/auth/calendar.events"
    const list = "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    expect(hasCalendarScope("gmail", `openid ${events}`)).toBe(false)
    expect(hasCalendarScope("gmail", `openid ${events} ${list}`)).toBe(true)
  })
  it("finds Graph's scope in either form", () => {
    expect(hasCalendarScope("outlook", "https://graph.microsoft.com/Calendars.ReadWrite Mail.Send")).toBe(true)
    expect(hasCalendarScope("outlook", "Calendars.ReadWrite")).toBe(true)
    expect(hasCalendarScope("outlook", "Mail.ReadWrite")).toBe(false)
  })
})
