import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventInput,
  CalendarRepeat,
  CalendarResponse,
  CalendarView,
} from "./calendar-types"
import { isTimeZone, wallTimeToInstant } from "./calendar-time"
import { deleteResource, getJson, sendJson } from "./http"
import { GRAPH_BASE } from "./outlook-sync"

type GraphCalendar = {
  id: string
  name?: string
  hexColor?: string
  canEdit?: boolean
  isDefaultCalendar?: boolean
}

type GraphAddress = { emailAddress?: { name?: string; address?: string } }
type GraphAttendee = GraphAddress & {
  type?: "required" | "optional" | "resource"
  status?: { response?: GraphResponse }
}
type GraphResponse = "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded"
type GraphTime = { dateTime?: string; timeZone?: string }
type GraphEvent = {
  id: string
  subject?: string
  body?: { contentType?: string; content?: string }
  location?: { displayName?: string }
  start?: GraphTime
  end?: GraphTime
  isAllDay?: boolean
  isCancelled?: boolean
  isOrganizer?: boolean
  organizer?: GraphAddress
  attendees?: GraphAttendee[]
  responseStatus?: { response?: GraphResponse }
  type?: "singleInstance" | "occurrence" | "exception" | "seriesMaster"
  seriesMasterId?: string
  onlineMeeting?: { joinUrl?: string } | null
  onlineMeetingUrl?: string | null
  webLink?: string
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown"
}

const SELECT =
  "id,subject,body,location,start,end,isAllDay,isCancelled,isOrganizer,organizer,attendees,responseStatus,type,seriesMasterId,onlineMeeting,onlineMeetingUrl,webLink,showAs"

/** Times in the app's own zone (all-day events stay on their dates), bodies as text. */
const preferHeaders = (timeZone: string) => ({
  Prefer: `outlook.timezone="${timeZone}", outlook.body-content-type="text"`,
})

const calendarUrl = (calendarId: string) => `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}`
const eventUrl = (calendarId: string, eventId: string) =>
  `${calendarUrl(calendarId)}/events/${encodeURIComponent(eventId)}`

export async function listOutlookCalendars(accessToken: string, accountId: string): Promise<CalendarView[]> {
  const calendars: GraphCalendar[] = []
  let url: string | undefined = `${GRAPH_BASE}/me/calendars?$top=100&$select=id,name,hexColor,canEdit,isDefaultCalendar`
  while (url) {
    const page: { value?: GraphCalendar[]; "@odata.nextLink"?: string } = await getJson(url, accessToken)
    calendars.push(...(page.value ?? []))
    url = page["@odata.nextLink"]
  }
  return calendars.map((calendar) => ({
    id: calendar.id,
    accountId,
    name: calendar.name ?? "",
    color: calendar.hexColor || null,
    canEdit: Boolean(calendar.canEdit),
    primary: Boolean(calendar.isDefaultCalendar),
    shownByDefault: true,
  }))
}

const RESPONSES: Record<GraphResponse, CalendarResponse | null> = {
  none: "needsAction",
  notResponded: "needsAction",
  organizer: null,
  tentativelyAccepted: "tentative",
  accepted: "accepted",
  declined: "declined",
}

/** Graph answers in the zone it was asked for, or says which one it used. */
function instant(time: GraphTime, asked: string) {
  const wall = time.dateTime!.slice(0, 19)
  const zone = time.timeZone ?? asked
  if (/^(utc|etc\/utc|gmt)$/i.test(zone)) return new Date(`${wall}Z`).toISOString()
  return wallTimeToInstant(wall, isTimeZone(zone) ? zone : asked).toISOString()
}

function toEvent(event: GraphEvent, calendar: CalendarView, mailbox: string, timeZone: string): CalendarEvent | null {
  if (event.isCancelled || event.type === "seriesMaster" || !event.start?.dateTime || !event.end?.dateTime) return null
  const allDay = Boolean(event.isAllDay)
  const me = mailbox.toLowerCase()
  const organizerEmail = event.organizer?.emailAddress?.address ?? null
  const isOrganizer = Boolean(event.isOrganizer)
  const attendees: CalendarAttendee[] = (event.attendees ?? [])
    .filter((attendee) => attendee.type !== "resource" && attendee.emailAddress?.address)
    .map((attendee) => {
      const email = attendee.emailAddress!.address!
      const isMe = email.toLowerCase() === me
      return {
        email,
        name: attendee.emailAddress?.name ?? null,
        response: RESPONSES[attendee.status?.response ?? "none"] ?? "accepted",
        organizer: Boolean(organizerEmail && email.toLowerCase() === organizerEmail.toLowerCase()),
        self: isMe,
        optional: attendee.type === "optional",
      }
    })
  // Graph leaves the organizer out of the guests; the app lists them first.
  if (organizerEmail && attendees.length > 0 && !attendees.some((attendee) => attendee.organizer))
    attendees.unshift({
      email: organizerEmail,
      name: event.organizer?.emailAddress?.name ?? null,
      response: "accepted",
      organizer: true,
      self: organizerEmail.toLowerCase() === me,
      optional: false,
    })
  const answer = RESPONSES[event.responseStatus?.response ?? "none"]
  return {
    id: event.id,
    accountId: calendar.accountId,
    calendarId: calendar.id,
    title: event.subject ?? "",
    location: event.location?.displayName || null,
    description: event.body?.content?.trim() || null,
    start: allDay ? event.start.dateTime.slice(0, 10) : instant(event.start, timeZone),
    end: allDay ? event.end.dateTime.slice(0, 10) : instant(event.end, timeZone),
    allDay,
    organizer: organizerEmail ? { email: organizerEmail, name: event.organizer?.emailAddress?.name ?? null } : null,
    isOrganizer,
    attendees,
    myResponse: isOrganizer || attendees.length === 0 ? null : answer,
    recurring: Boolean(event.seriesMasterId) || event.type === "occurrence" || event.type === "exception",
    meetingUrl: event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl ?? null,
    webLink: event.webLink ?? null,
    free: event.showAs === "free",
    canEdit: calendar.canEdit && isOrganizer,
  }
}

export async function listOutlookEvents(
  accessToken: string,
  calendar: CalendarView,
  mailbox: string,
  from: Date,
  to: Date,
  timeZone: string
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = []
  const params = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $top: "500",
    $select: SELECT,
  })
  let url: string | undefined = `${calendarUrl(calendar.id)}/calendarView?${params}`
  while (url) {
    const page: { value?: GraphEvent[]; "@odata.nextLink"?: string } = await getJson(
      url,
      accessToken,
      preferHeaders(timeZone)
    )
    for (const item of page.value ?? []) {
      const event = toEvent(item, calendar, mailbox, timeZone)
      if (event) events.push(event)
    }
    url = page["@odata.nextLink"]
  }
  return events
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

function recurrence(repeat: CalendarRepeat, start: string) {
  if (repeat === "none") return undefined
  const date = new Date(`${start.slice(0, 10)}T12:00:00Z`)
  const pattern =
    repeat === "daily"
      ? { type: "daily", interval: 1 }
      : repeat === "weekdays"
        ? { type: "weekly", interval: 1, daysOfWeek: DAYS.slice(1, 6), firstDayOfWeek: "monday" }
        : repeat === "weekly"
          ? { type: "weekly", interval: 1, daysOfWeek: [DAYS[date.getUTCDay()]], firstDayOfWeek: "monday" }
          : repeat === "monthly"
            ? { type: "absoluteMonthly", interval: 1, dayOfMonth: date.getUTCDate() }
            : { type: "absoluteYearly", interval: 1, dayOfMonth: date.getUTCDate(), month: date.getUTCMonth() + 1 }
  return { pattern, range: { type: "noEnd", startDate: start.slice(0, 10) } }
}

const time = (value: string, allDay: boolean, timeZone: string) => ({
  dateTime: allDay ? `${value.slice(0, 10)}T00:00:00` : `${value.slice(0, 16)}:00`,
  timeZone,
})

function attendeesOf(input: CalendarEventInput, existing: GraphEvent | undefined, mailbox: string) {
  const kept = new Map((existing?.attendees ?? []).map((attendee) => [attendee.emailAddress?.address?.toLowerCase(), attendee]))
  const me = mailbox.toLowerCase()
  return [
    ...(existing?.attendees ?? []).filter((attendee) => attendee.type === "resource"),
    ...input.attendees
      .filter((person) => person.email.toLowerCase() !== me)
      .map(
        (person) =>
          kept.get(person.email.toLowerCase()) ?? {
            emailAddress: { address: person.email, ...(person.name && { name: person.name }) },
            type: "required" as const,
          }
      ),
  ].map(({ emailAddress, type }) => ({ emailAddress, type }))
}

export async function createOutlookEvent(
  accessToken: string,
  calendar: CalendarView,
  mailbox: string,
  input: CalendarEventInput
): Promise<CalendarEvent | null> {
  const created = await sendJson(
    "POST",
    `${calendarUrl(calendar.id)}/events`,
    accessToken,
    {
      subject: input.title,
      body: { contentType: "text", content: input.description },
      location: { displayName: input.location },
      start: time(input.start, input.allDay, input.timeZone),
      end: time(input.end, input.allDay, input.timeZone),
      isAllDay: input.allDay,
      attendees: attendeesOf(input, undefined, mailbox),
      ...(input.repeat && input.repeat !== "none" && { recurrence: recurrence(input.repeat, input.start) }),
    },
    preferHeaders(input.timeZone)
  )
  const event = (await created.json()) as GraphEvent
  // A new series answers with its master; the app shows its first occurrence on the next read.
  if (event.type === "seriesMaster") return null
  return toEvent(event, calendar, mailbox, input.timeZone)
}

export async function updateOutlookEvent(
  accessToken: string,
  calendar: CalendarView,
  mailbox: string,
  eventId: string,
  input: CalendarEventInput
): Promise<CalendarEvent | null> {
  const headers = preferHeaders(input.timeZone)
  const existing = await getJson<GraphEvent>(`${eventUrl(calendar.id, eventId)}?$select=${SELECT}`, accessToken, headers)
  // A Teams invitation lives in the HTML body; it is only rewritten when the text really changed.
  const description = existing.body?.content?.trim() ?? ""
  const updated = await sendJson(
    "PATCH",
    eventUrl(calendar.id, eventId),
    accessToken,
    {
      subject: input.title,
      ...(input.description.trim() !== description && { body: { contentType: "text", content: input.description } }),
      location: { displayName: input.location },
      start: time(input.start, input.allDay, input.timeZone),
      end: time(input.end, input.allDay, input.timeZone),
      isAllDay: input.allDay,
      attendees: attendeesOf(input, existing, mailbox),
    },
    headers
  )
  return toEvent((await updated.json()) as GraphEvent, calendar, mailbox, input.timeZone)
}

/**
 * Removes the event, or with `series` the whole series. An organizer's meeting
 * is cancelled, so the guests hear of it.
 */
export async function deleteOutlookEvent(accessToken: string, calendarId: string, eventId: string, series: boolean) {
  const event = await getJson<GraphEvent>(
    `${eventUrl(calendarId, eventId)}?$select=id,isOrganizer,attendees,seriesMasterId`,
    accessToken
  )
  const id = series && event.seriesMasterId ? event.seriesMasterId : eventId
  if (event.isOrganizer && (event.attendees ?? []).length > 0) {
    await sendJson("POST", `${eventUrl(calendarId, id)}/cancel`, accessToken, { comment: "" })
    return
  }
  await deleteResource(eventUrl(calendarId, id), accessToken)
}

const ACTIONS: Record<Exclude<CalendarResponse, "needsAction">, string> = {
  accepted: "accept",
  tentative: "tentativelyAccept",
  declined: "decline",
}

export async function respondOutlookEvent(
  accessToken: string,
  calendar: CalendarView,
  mailbox: string,
  eventId: string,
  answer: Exclude<CalendarResponse, "needsAction">,
  timeZone: string
): Promise<CalendarEvent | null> {
  await sendJson("POST", `${eventUrl(calendar.id, eventId)}/${ACTIONS[answer]}`, accessToken, { sendResponse: true })
  // Declining takes the event out of the calendar.
  if (answer === "declined") return null
  const event = await getJson<GraphEvent>(
    `${eventUrl(calendar.id, eventId)}?$select=${SELECT}`,
    accessToken,
    preferHeaders(timeZone)
  )
  return toEvent(event, calendar, mailbox, timeZone)
}
