/**
 * Even plannen: the calendars of a connected mailbox (Google Calendar, Outlook).
 * Events are read from the provider when asked for and never stored. Shared by
 * the API and the app.
 */

/** Google's scopes for reading and changing events and listing calendars. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
]
/** Microsoft Graph's scope for calendars; one covers reading, writing and answering. */
export const OUTLOOK_CALENDAR_SCOPE = "Calendars.ReadWrite"

/** Whether the grant a mailbox holds covers its calendars. */
export function hasCalendarScope(provider: "gmail" | "outlook", scope: string) {
  const granted = scope.split(/\s+/)
  if (provider === "gmail") return GOOGLE_CALENDAR_SCOPES.every((name) => granted.includes(name))
  return granted.some((name) => name.toLowerCase().endsWith(OUTLOOK_CALENDAR_SCOPE.toLowerCase()))
}

export type CalendarResponse = "accepted" | "tentative" | "declined" | "needsAction"

/** One calendar of a mailbox: the main one, a shared one, a holiday calendar. */
export type CalendarView = {
  /** The provider's id; unique within the mailbox. */
  id: string
  accountId: string
  name: string
  /** The provider's colour (#rrggbb), when it has one. */
  color: string | null
  canEdit: boolean
  primary: boolean
  /** Whether the provider shows it by default (Google's "selected"). */
  shownByDefault: boolean
}

export type CalendarPerson = { email: string; name: string | null }

export type CalendarAttendee = CalendarPerson & {
  response: CalendarResponse
  organizer: boolean
  /** The mailbox itself. */
  self: boolean
  optional: boolean
}

export type CalendarEvent = {
  /** The provider's id of this occurrence. */
  id: string
  accountId: string
  calendarId: string
  title: string
  location: string | null
  /** Plain text. */
  description: string | null
  /**
   * Timed events: an instant in ISO 8601 (UTC). All-day events: a date
   * ("2026-11-16"), with `end` the day after the last one.
   */
  start: string
  end: string
  allDay: boolean
  organizer: CalendarPerson | null
  isOrganizer: boolean
  attendees: CalendarAttendee[]
  /** The mailbox's own answer to an invitation; null when it organizes or nobody was invited. */
  myResponse: CalendarResponse | null
  /** Part of a repeating series. */
  recurring: boolean
  /** A video call link (Meet, Teams). */
  meetingUrl: string | null
  /** The event in the provider's own calendar. */
  webLink: string | null
  /** Shown as free rather than busy. */
  free: boolean
  /** Whether this mailbox may change the event itself (time, title). */
  canEdit: boolean
}

export const CALENDAR_REPEATS = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"] as const
export type CalendarRepeat = (typeof CALENDAR_REPEATS)[number]

/** A new event, or the fields of one that change. */
export type CalendarEventInput = {
  title: string
  /** As in CalendarEvent; timed ones as local wall time "2026-11-16T09:30" in `timeZone`. */
  start: string
  end: string
  allDay: boolean
  /** IANA name, such as Europe/Amsterdam. */
  timeZone: string
  location: string
  description: string
  attendees: CalendarPerson[]
  /** Only when creating; a series keeps the rhythm it has. */
  repeat?: CalendarRepeat
}

export type CalendarAccountState = "ok" | "needs_access" | "reauth" | "failed"

/** A mailbox as the calendar app lists it, with its calendars once it may read them. */
export type CalendarAccountView = {
  id: string
  provider: "gmail" | "outlook"
  email: string
  color: number
  state: CalendarAccountState
  calendars: CalendarView[]
}

/** The longest stretch one request may ask for: a month view shows six weeks. */
export const MAX_RANGE_DAYS = 62
