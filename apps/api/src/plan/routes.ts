import { Hono, type Context } from "hono"
import { every } from "hono/combine"
import { z } from "zod"
import { CALENDAR_REPEATS, MAX_RANGE_DAYS } from "@even/mail-core/calendar-types"
import { isTimeZone } from "@even/mail-core/calendar-time"
import { isRateLimited, ProviderError, ReauthRequiredError } from "@even/mail-core/provider"
import { isMailProvider } from "@even/mail-core/types"
import { msg } from "../i18n"
import { canUse, requireAppAccess } from "../lib/access"
import { activeOrganization } from "../lib/organization"
import { report } from "../lib/report"
import { noStore, requireSession as signedIn, requireTrustedOrigin, type AppEnv } from "../lib/session"
import { MailNotConfiguredError, startConnect, type MailViewer } from "../mail/accounts-server"
import {
  CalendarAccessError,
  CalendarNotFoundError,
  CalendarReadOnlyError,
  createEvent,
  deleteEvent,
  listCalendarAccounts,
  listEvents,
  respondToEvent,
  updateEvent,
} from "./calendar-server"

/**
 * Even plannen: the calendars of the mailboxes connected in Even mailen. It
 * comes with Even mailen, so the same invitation or subscription lets you in.
 */
const requireSession = every(signedIn, requireAppAccess("mail"))

const viewerOf = async (c: Context<AppEnv>): Promise<MailViewer> => ({
  userId: c.get("session").user.id,
  organizationId: await activeOrganization(c),
})

const DAY_MS = 24 * 60 * 60 * 1000
const id = z.string().min(1).max(2000)
const timeZone = z.string().max(100).refine(isTimeZone)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
const person = z.object({ email: z.email().max(320), name: z.string().max(200).nullable() })
const eventFields = z
  .object({
    title: z.string().max(1000),
    start: date,
    end: date,
    allDay: z.boolean(),
    timeZone,
    location: z.string().max(1000),
    description: z.string().max(20_000),
    attendees: z.array(person).max(200),
    repeat: z.enum(CALENDAR_REPEATS).optional(),
  })
  .refine((event) => event.end >= event.start)
const target = z.object({ accountId: id, calendarId: id })
const ref = target.extend({ eventId: id })
const createBody = z.object({ target, event: eventFields })
const updateBody = z.object({ ref, event: eventFields })
const deleteBody = z.object({ ref, series: z.boolean().default(false) })
const respondBody = z.object({ ref, answer: z.enum(["accepted", "tentative", "declined"]), timeZone })

async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

function failure(c: Context, error: unknown) {
  if (error instanceof CalendarNotFoundError || (error instanceof ProviderError && [404, 410].includes(error.status ?? 0)))
    return c.json({ error: msg(c, "calendarGone") }, 404)
  if (error instanceof CalendarReadOnlyError) return c.json({ error: msg(c, "calendarReadOnly") }, 403)
  if (error instanceof CalendarAccessError || (error instanceof ProviderError && error.status === 403))
    return c.json({ error: msg(c, "calendarNoAccess"), needsAccess: true }, 403)
  if (error instanceof ReauthRequiredError) return c.json({ error: msg(c, "mailReconnect"), reauth: true }, 409)
  if (error instanceof MailNotConfiguredError) return c.json({ error: msg(c, "mailNotConfigured") }, 503)
  if (isRateLimited(error)) return c.json({ error: msg(c, "mailBusy") }, 429)
  report("Calendar request failed", error)
  return c.json({ error: msg(c, "calendarFailed") }, 502)
}

export const planRoutes = new Hono<AppEnv>()

planRoutes.get("/accounts", requireSession, async (c) =>
  c.json({ accounts: await listCalendarAccounts(await viewerOf(c)) }, 200, noStore)
)

// ?from=…&to=… (instants), ?tz=Europe/Amsterdam, ?hidden=account:calendar,… to leave out.
planRoutes.get("/events", requireSession, async (c) => {
  const from = new Date(c.req.query("from") ?? "")
  const to = new Date(c.req.query("to") ?? "")
  const zone = c.req.query("tz") ?? "UTC"
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to <= from ||
    to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS ||
    !isTimeZone(zone)
  )
    return c.json({ error: msg(c, "invalidRequest") }, 400)
  const hidden = new Set(c.req.queries("hidden") ?? [])
  return c.json(await listEvents(await viewerOf(c), from, to, zone, hidden), 200, noStore)
})

planRoutes.post("/events", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, createBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json({ event: await createEvent(await viewerOf(c), body.target, body.event) }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

planRoutes.patch("/events", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, updateBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json({ event: await updateEvent(await viewerOf(c), body.ref, body.event) }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// A POST rather than DELETE: event ids are long and go in the body.
planRoutes.post("/events/delete", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, deleteBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await deleteEvent(await viewerOf(c), body.ref, body.series)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

planRoutes.post("/events/respond", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, respondBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const event = await respondToEvent(await viewerOf(c), body.ref, body.answer, body.timeZone)
    return c.json({ event }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

/** Connects a mailbox, or asks an existing one again, with its calendars this time. */
planRoutes.post("/connect/:provider", requireTrustedOrigin, requireSession, async (c) => {
  const provider = c.req.param("provider")
  if (!isMailProvider(provider)) return c.json({ error: msg(c, "invalidRequest") }, 400)
  if (provider === "gmail" && !(await canUse(c.get("session").user, "gmail")))
    return c.json({ error: msg(c, "gmailInviteOnly"), gmailInvite: true }, 403)
  try {
    return c.json({ url: await startConnect(await viewerOf(c), provider, "plan") }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})
