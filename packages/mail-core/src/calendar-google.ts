import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventInput,
  CalendarRepeat,
  CalendarResponse,
  CalendarView,
} from "./calendar-types"
import { deleteResource, getJson, sendJson } from "./http"

const API = "https://www.googleapis.com/calendar/v3"

type GoogleCalendar = {
  id: string
  summary?: string
  summaryOverride?: string
  backgroundColor?: string
  accessRole?: "freeBusyReader" | "reader" | "writer" | "owner"
  primary?: boolean
  selected?: boolean
  hidden?: boolean
}

type GooglePerson = { email?: string; displayName?: string; self?: boolean }
type GoogleAttendee = GooglePerson & {
  organizer?: boolean
  optional?: boolean
  resource?: boolean
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted"
}
type GoogleTime = { date?: string; dateTime?: string; timeZone?: string }
type GoogleEvent = {
  id: string
  status?: "confirmed" | "tentative" | "cancelled"
  summary?: string
  location?: string
  description?: string
  start?: GoogleTime
  end?: GoogleTime
  organizer?: GooglePerson
  attendees?: GoogleAttendee[]
  recurringEventId?: string
  recurrence?: string[]
  hangoutLink?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  htmlLink?: string
  transparency?: "opaque" | "transparent"
  guestsCanModify?: boolean
  eventType?: string
}

const calendarUrl = (calendarId: string) => `${API}/calendars/${encodeURIComponent(calendarId)}`
const eventUrl = (calendarId: string, eventId: string) =>
  `${calendarUrl(calendarId)}/events/${encodeURIComponent(eventId)}`

export async function listGoogleCalendars(accessToken: string, accountId: string): Promise<CalendarView[]> {
  const calendars: GoogleCalendar[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ maxResults: "250", ...(pageToken && { pageToken }) })
    const page = await getJson<{ items?: GoogleCalendar[]; nextPageToken?: string }>(
      `${API}/users/me/calendarList?${params}`,
      accessToken
    )
    calendars.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)
  return (
    calendars
      // Free/busy only shows blocks of time without anything to read.
      .filter((calendar) => calendar.accessRole !== "freeBusyReader" && !calendar.hidden)
      .map((calendar) => ({
        id: calendar.id,
        accountId,
        name: calendar.summaryOverride ?? calendar.summary ?? calendar.id,
        color: calendar.backgroundColor ?? null,
        canEdit: calendar.accessRole === "owner" || calendar.accessRole === "writer",
        primary: Boolean(calendar.primary),
        shownByDefault: Boolean(calendar.primary || calendar.selected),
      }))
  )
}

/** Descriptions written in Google Calendar may be HTML; the app shows text. */
function htmlToText(value: string) {
  if (!/<[a-z][\s\S]*>/i.test(value)) return value
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const response = (status: GoogleAttendee["responseStatus"]): CalendarResponse => status ?? "needsAction"

function toEvent(event: GoogleEvent, calendar: CalendarView): CalendarEvent | null {
  if (event.status === "cancelled" || !event.start || !event.end) return null
  const allDay = Boolean(event.start.date)
  const start = allDay ? event.start.date : event.start.dateTime && new Date(event.start.dateTime).toISOString()
  const end = allDay ? event.end.date : event.end.dateTime && new Date(event.end.dateTime).toISOString()
  if (!start || !end) return null
  const attendees: CalendarAttendee[] = (event.attendees ?? [])
    .filter((attendee) => attendee.email && !attendee.resource)
    .map((attendee) => ({
      email: attendee.email!,
      name: attendee.displayName ?? null,
      response: response(attendee.responseStatus),
      organizer: Boolean(attendee.organizer),
      self: Boolean(attendee.self),
      optional: Boolean(attendee.optional),
    }))
  const isOrganizer = Boolean(event.organizer?.self) || attendees.length === 0
  const self = attendees.find((attendee) => attendee.self)
  const video = event.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri
  return {
    id: event.id,
    accountId: calendar.accountId,
    calendarId: calendar.id,
    title: event.summary ?? "",
    location: event.location || null,
    description: event.description ? htmlToText(event.description) : null,
    start,
    end,
    allDay,
    organizer: event.organizer?.email
      ? { email: event.organizer.email, name: event.organizer.displayName ?? null }
      : null,
    isOrganizer,
    attendees,
    myResponse: isOrganizer || !self ? null : self.response,
    recurring: Boolean(event.recurringEventId || event.recurrence),
    meetingUrl: event.hangoutLink ?? video ?? null,
    webLink: event.htmlLink ?? null,
    free: event.transparency === "transparent",
    canEdit: calendar.canEdit && (isOrganizer || Boolean(event.guestsCanModify)),
  }
}

/** The events in [from, to), repeating ones as their single occurrences. */
export async function listGoogleEvents(
  accessToken: string,
  calendar: CalendarView,
  from: Date,
  to: Date
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      ...(pageToken && { pageToken }),
    })
    const page = await getJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      `${calendarUrl(calendar.id)}/events?${params}`,
      accessToken
    )
    for (const item of page.items ?? []) {
      const event = toEvent(item, calendar)
      if (event) events.push(event)
    }
    pageToken = page.nextPageToken
  } while (pageToken)
  return events
}

const RULES: Record<Exclude<CalendarRepeat, "none">, string> = {
  daily: "RRULE:FREQ=DAILY",
  weekdays: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "RRULE:FREQ=WEEKLY",
  monthly: "RRULE:FREQ=MONTHLY",
  yearly: "RRULE:FREQ=YEARLY",
}

const time = (value: string, allDay: boolean, timeZone: string): GoogleTime =>
  allDay ? { date: value.slice(0, 10) } : { dateTime: `${value.slice(0, 16)}:00`, timeZone }

function body(input: CalendarEventInput, existing?: GoogleEvent) {
  const kept = new Map((existing?.attendees ?? []).map((attendee) => [attendee.email?.toLowerCase(), attendee]))
  return {
    summary: input.title,
    location: input.location,
    description: input.description,
    start: time(input.start, input.allDay, input.timeZone),
    end: time(input.end, input.allDay, input.timeZone),
    // Who stays keeps their answer; resources (rooms) stay too.
    attendees: [
      ...(existing?.attendees ?? []).filter((attendee) => attendee.resource || attendee.self || attendee.organizer),
      ...input.attendees
        .filter((person) => {
          const known = kept.get(person.email.toLowerCase())
          return !known || !(known.resource || known.self || known.organizer)
        })
        .map((person) => kept.get(person.email.toLowerCase()) ?? { email: person.email, displayName: person.name ?? undefined }),
    ],
    ...(input.repeat && input.repeat !== "none" && { recurrence: [RULES[input.repeat]] }),
  }
}

export async function createGoogleEvent(
  accessToken: string,
  calendar: CalendarView,
  input: CalendarEventInput
): Promise<CalendarEvent | null> {
  const created = await sendJson("POST", `${calendarUrl(calendar.id)}/events?sendUpdates=all`, accessToken, body(input))
  return toEvent((await created.json()) as GoogleEvent, calendar)
}

export async function updateGoogleEvent(
  accessToken: string,
  calendar: CalendarView,
  eventId: string,
  input: CalendarEventInput
): Promise<CalendarEvent | null> {
  const existing = await getJson<GoogleEvent>(eventUrl(calendar.id, eventId), accessToken)
  const { recurrence: _ignored, ...change } = body(input, existing)
  const updated = await sendJson("PATCH", `${eventUrl(calendar.id, eventId)}?sendUpdates=all`, accessToken, change)
  return toEvent((await updated.json()) as GoogleEvent, calendar)
}

/** Removes the event, or with `series` every occurrence of it. Guests hear of it. */
export async function deleteGoogleEvent(accessToken: string, calendarId: string, eventId: string, series: boolean) {
  let id = eventId
  if (series) {
    const event = await getJson<GoogleEvent>(eventUrl(calendarId, eventId), accessToken)
    id = event.recurringEventId ?? eventId
  }
  await deleteResource(`${eventUrl(calendarId, id)}?sendUpdates=all`, accessToken)
}

/** Answers an invitation: the mailbox's own attendee entry changes, and the organizer hears it. */
export async function respondGoogleEvent(
  accessToken: string,
  calendar: CalendarView,
  eventId: string,
  answer: Exclude<CalendarResponse, "needsAction">
): Promise<CalendarEvent | null> {
  const event = await getJson<GoogleEvent>(eventUrl(calendar.id, eventId), accessToken)
  const attendees = (event.attendees ?? []).map((attendee) =>
    attendee.self ? { ...attendee, responseStatus: answer } : attendee
  )
  const updated = await sendJson("PATCH", `${eventUrl(calendar.id, eventId)}?sendUpdates=all`, accessToken, { attendees })
  return toEvent((await updated.json()) as GoogleEvent, calendar)
}
