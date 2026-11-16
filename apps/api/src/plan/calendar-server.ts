import type { MailAccount } from "@even/db"
import { getDb } from "@even/db"
import {
  createGoogleEvent,
  deleteGoogleEvent,
  listGoogleCalendars,
  listGoogleEvents,
  respondGoogleEvent,
  updateGoogleEvent,
} from "@even/mail-core/calendar-google"
import {
  createOutlookEvent,
  deleteOutlookEvent,
  listOutlookCalendars,
  listOutlookEvents,
  respondOutlookEvent,
  updateOutlookEvent,
} from "@even/mail-core/calendar-outlook"
import {
  hasCalendarScope,
  type CalendarAccountView,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarResponse,
  type CalendarView,
} from "@even/mail-core/calendar-types"
import { mapInChunks } from "@even/mail-core/http"
import { ProviderError, ReauthRequiredError } from "@even/mail-core/provider"
import { MailAccountNotFoundError, ownedAccount, withAccessToken, type MailViewer } from "../mail/accounts-server"
import { report } from "../lib/report"

export class CalendarNotFoundError extends Error {}
export class CalendarReadOnlyError extends Error {}
export class CalendarAccessError extends Error {}

/** Refused for lack of the calendar grant (Google 403, Graph ErrorAccessDenied). */
const isMissingAccess = (error: unknown) => error instanceof ProviderError && error.status === 403

const canReadCalendars = (account: MailAccount) => hasCalendarScope(account.provider, account.scope)

function calendarsOf(account: MailAccount, token: string) {
  return account.provider === "gmail"
    ? listGoogleCalendars(token, account.id)
    : listOutlookCalendars(token, account.id)
}

/** The viewer's mailboxes in this organization: the calendars come with them. */
const connectedMailboxes = (viewer: MailViewer) =>
  getDb().mailConnection.findMany({
    where: { userId: viewer.userId, organizationId: viewer.organizationId },
    include: { account: true },
    orderBy: { createdAt: "asc" },
  })

type Loaded = { view: CalendarAccountView; account: MailAccount }

async function loadAccount(account: MailAccount, color: number): Promise<Loaded> {
  const base = { id: account.id, provider: account.provider, email: account.email, color }
  if (account.status !== "active") return { account, view: { ...base, state: "reauth", calendars: [] } }
  if (!canReadCalendars(account)) return { account, view: { ...base, state: "needs_access", calendars: [] } }
  try {
    const calendars = await withAccessToken(account, (_provider, token) => calendarsOf(account, token))
    return { account, view: { ...base, state: "ok", calendars } }
  } catch (error) {
    if (error instanceof ReauthRequiredError) return { account, view: { ...base, state: "reauth", calendars: [] } }
    if (isMissingAccess(error)) return { account, view: { ...base, state: "needs_access", calendars: [] } }
    report("Calendar list failed", error)
    return { account, view: { ...base, state: "failed", calendars: [] } }
  }
}

export async function listCalendarAccounts(viewer: MailViewer): Promise<CalendarAccountView[]> {
  const connections = await connectedMailboxes(viewer)
  const loaded = await Promise.all(connections.map((connection) => loadAccount(connection.account, connection.color)))
  return loaded.map((entry) => entry.view)
}

/**
 * The events in [from, to) of every calendar the viewer can read. A mailbox that
 * fails is named in `failed` instead of failing the rest.
 */
export async function listEvents(viewer: MailViewer, from: Date, to: Date, timeZone: string, hidden: Set<string>) {
  const connections = await connectedMailboxes(viewer)
  const events: CalendarEvent[] = []
  const failed: string[] = []
  await Promise.all(
    connections.map(async ({ account }) => {
      if (account.status !== "active" || !canReadCalendars(account)) return
      try {
        await withAccessToken(account, async (_provider, token) => {
          const calendars = (await calendarsOf(account, token)).filter(
            (calendar) => !hidden.has(`${account.id}:${calendar.id}`)
          )
          // A few calendars at a time keeps within the providers' limits.
          const lists = await mapInChunks(calendars, 4, (calendar) =>
            account.provider === "gmail"
              ? listGoogleEvents(token, calendar, from, to)
              : listOutlookEvents(token, calendar, account.email, from, to, timeZone)
          )
          for (const list of lists) events.push(...list)
        })
      } catch (error) {
        if (!(error instanceof ReauthRequiredError) && !isMissingAccess(error)) report("Calendar events failed", error)
        failed.push(account.id)
      }
    })
  )
  events.sort((a, b) => a.start.localeCompare(b.start))
  return { events, failed }
}

/** A calendar of one of the viewer's mailboxes, with a token to use on it. */
async function withCalendar<T>(
  viewer: MailViewer,
  accountId: string,
  calendarId: string,
  call: (account: MailAccount, calendar: CalendarView, token: string) => Promise<T>
) {
  const account = await ownedAccount(viewer, accountId).catch((error) => {
    if (error instanceof MailAccountNotFoundError) throw new CalendarNotFoundError()
    throw error
  })
  if (!canReadCalendars(account)) throw new CalendarAccessError()
  return withAccessToken(account, async (_provider, token) => {
    const calendar = (await calendarsOf(account, token)).find((candidate) => candidate.id === calendarId)
    if (!calendar) throw new CalendarNotFoundError()
    return call(account, calendar, token)
  })
}

export type EventRef = { accountId: string; calendarId: string; eventId: string }

export function createEvent(
  viewer: MailViewer,
  target: { accountId: string; calendarId: string },
  input: CalendarEventInput
) {
  return withCalendar(viewer, target.accountId, target.calendarId, (account, calendar, token) => {
    if (!calendar.canEdit) throw new CalendarReadOnlyError()
    return account.provider === "gmail"
      ? createGoogleEvent(token, calendar, input)
      : createOutlookEvent(token, calendar, account.email, input)
  })
}

export function updateEvent(viewer: MailViewer, ref: EventRef, input: CalendarEventInput) {
  return withCalendar(viewer, ref.accountId, ref.calendarId, (account, calendar, token) => {
    if (!calendar.canEdit) throw new CalendarReadOnlyError()
    return account.provider === "gmail"
      ? updateGoogleEvent(token, calendar, ref.eventId, input)
      : updateOutlookEvent(token, calendar, account.email, ref.eventId, input)
  })
}

export function deleteEvent(viewer: MailViewer, ref: EventRef, series: boolean) {
  return withCalendar(viewer, ref.accountId, ref.calendarId, (account, calendar, token) =>
    account.provider === "gmail"
      ? deleteGoogleEvent(token, calendar.id, ref.eventId, series)
      : deleteOutlookEvent(token, calendar.id, ref.eventId, series)
  )
}

export function respondToEvent(
  viewer: MailViewer,
  ref: EventRef,
  answer: Exclude<CalendarResponse, "needsAction">,
  timeZone: string
) {
  return withCalendar(viewer, ref.accountId, ref.calendarId, (account, calendar, token) =>
    account.provider === "gmail"
      ? respondGoogleEvent(token, calendar, ref.eventId, answer)
      : respondOutlookEvent(token, calendar, account.email, ref.eventId, answer, timeZone)
  )
}
