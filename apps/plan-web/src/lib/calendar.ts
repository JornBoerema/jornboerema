import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  CalendarAccountView,
  CalendarEvent,
  CalendarEventInput,
  CalendarResponse,
  CalendarView,
} from "@even/mail-core/calendar-types"
import { MAIL_ACCOUNT_COLORS } from "@even/mail-core/types"
import { appUrl, isDesktop } from "@even/auth/client"
import { watchChannel } from "@even/realtime/client"
import { api, errorText } from "./api"
import { localTimeZone } from "./dates"

/** The mailbox palette of Even mailen, so a mailbox has the same colour in both apps. */
export const ACCOUNT_COLORS = [
  "oklch(0.66 0.15 250)",
  "oklch(0.76 0.16 75)",
  "oklch(0.68 0.19 355)",
  "oklch(0.69 0.16 155)",
  "oklch(0.64 0.17 300)",
  "oklch(0.72 0.12 200)",
  "oklch(0.63 0.2 28)",
  "oklch(0.65 0.02 260)",
] as const

export const accountColor = (color: number) => ACCOUNT_COLORS[color % MAIL_ACCOUNT_COLORS]!

export const calendarKey = (accountId: string, calendarId: string) => `${accountId}:${calendarId}`
export const eventKey = (event: Pick<CalendarEvent, "accountId" | "calendarId" | "id">) =>
  `${event.accountId}:${event.calendarId}:${event.id}`

const ACCOUNTS_KEY = ["plan", "accounts"]
const EVENTS_KEY = ["plan", "events"]

export function useCalendarAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => api<{ accounts: CalendarAccountView[] }>("/api/plan/accounts"),
    staleTime: 5 * 60_000,
  })
}

/** Which calendars show: a choice made on this device, else what the provider shows by default. */
const SHOWN_KEY = "even.plan.shown"
const listeners = new Set<() => void>()
let shownCache: Record<string, boolean> | null = null

function readShown(): Record<string, boolean> {
  if (shownCache) return shownCache
  try {
    shownCache = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "{}") as Record<string, boolean>
  } catch {
    shownCache = {}
  }
  return shownCache
}

function writeShown(next: Record<string, boolean>) {
  shownCache = next
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(next))
  } catch {
    // Kept for this session only.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useShownCalendars(accounts: CalendarAccountView[] | undefined) {
  const choices = useSyncExternalStore(subscribe, readShown)
  const isShown = useCallback(
    (calendar: CalendarView) => choices[calendarKey(calendar.accountId, calendar.id)] ?? calendar.shownByDefault,
    [choices]
  )
  const toggle = useCallback(
    (calendar: CalendarView) =>
      writeShown({ ...readShown(), [calendarKey(calendar.accountId, calendar.id)]: !isShown(calendar) }),
    [isShown]
  )
  const hidden = useMemo(
    () =>
      (accounts ?? [])
        .flatMap((account) => account.calendars)
        .filter((calendar) => !isShown(calendar))
        .map((calendar) => calendarKey(calendar.accountId, calendar.id))
        .sort(),
    [accounts, isShown]
  )
  return { isShown, toggle, hidden }
}

type EventsAnswer = { events: CalendarEvent[]; failed: string[] }

export function eventsQueryKey(from: Date, to: Date, hidden: string[]): QueryKey {
  return [...EVENTS_KEY, from.toISOString(), to.toISOString(), hidden.join(",")]
}

export function useEvents(from: Date, to: Date, hidden: string[], enabled: boolean) {
  return useQuery({
    queryKey: eventsQueryKey(from, to, hidden),
    queryFn: () => {
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), tz: localTimeZone() })
      for (const key of hidden) params.append("hidden", key)
      return api<EventsAnswer>(`/api/plan/events?${params}`)
    },
    enabled,
    placeholderData: keepPreviousData,
    // Changes made in Outlook or Google show up without a reload.
    refetchInterval: 2 * 60_000,
    staleTime: 30_000,
  })
}

export type EventRef = { accountId: string; calendarId: string; eventId: string }
export const refOf = (event: CalendarEvent): EventRef => ({
  accountId: event.accountId,
  calendarId: event.calendarId,
  eventId: event.id,
})

/** Applies `change` to every loaded range at once, so the screen follows before the provider answers. */
function useEventsCache() {
  const queryClient = useQueryClient()
  const change = useCallback(
    (edit: (events: CalendarEvent[]) => CalendarEvent[]) => {
      const before = queryClient.getQueriesData<EventsAnswer>({ queryKey: EVENTS_KEY })
      queryClient.setQueriesData<EventsAnswer>({ queryKey: EVENTS_KEY }, (answer) =>
        answer ? { ...answer, events: edit(answer.events) } : answer
      )
      return () => {
        for (const [key, data] of before) queryClient.setQueryData(key, data)
      }
    },
    [queryClient]
  )
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: EVENTS_KEY }), [queryClient])
  return { change, refresh }
}

const sameRef = (event: CalendarEvent, ref: EventRef) =>
  event.id === ref.eventId && event.accountId === ref.accountId && event.calendarId === ref.calendarId

export function useEventActions() {
  const cache = useEventsCache()
  const timeZone = localTimeZone()

  const create = useMutation({
    mutationFn: (input: { target: { accountId: string; calendarId: string }; event: CalendarEventInput }) =>
      api<{ event: CalendarEvent | null }>("/api/plan/events", { method: "POST", body: JSON.stringify(input) }),
    onSettled: cache.refresh,
    onError: (error) => toast.error(errorText(error)),
  })

  const update = useMutation({
    mutationFn: (input: { ref: EventRef; event: CalendarEventInput; optimistic?: CalendarEvent }) =>
      api<{ event: CalendarEvent | null }>("/api/plan/events", {
        method: "PATCH",
        body: JSON.stringify({ ref: input.ref, event: input.event }),
      }),
    onMutate: ({ ref, optimistic }) =>
      optimistic ? cache.change((events) => events.map((event) => (sameRef(event, ref) ? optimistic : event))) : undefined,
    onError: (error, _input, undo) => {
      undo?.()
      toast.error(errorText(error))
    },
    onSettled: cache.refresh,
  })

  const remove = useMutation({
    mutationFn: (input: { ref: EventRef; series: boolean }) =>
      api("/api/plan/events/delete", { method: "POST", body: JSON.stringify(input) }),
    onMutate: ({ ref, series }) =>
      // A whole series goes on the next read; one event goes now.
      series ? undefined : cache.change((events) => events.filter((event) => !sameRef(event, ref))),
    onError: (error, _input, undo) => {
      undo?.()
      toast.error(errorText(error))
    },
    onSettled: cache.refresh,
  })

  const respond = useMutation({
    mutationFn: (input: { ref: EventRef; answer: Exclude<CalendarResponse, "needsAction"> }) =>
      api<{ event: CalendarEvent | null }>("/api/plan/events/respond", {
        method: "POST",
        body: JSON.stringify({ ...input, timeZone }),
      }),
    onMutate: ({ ref, answer }) =>
      cache.change((events) => events.map((event) => (sameRef(event, ref) ? { ...event, myResponse: answer } : event))),
    onError: (error, _input, undo) => {
      undo?.()
      toast.error(errorText(error))
    },
    onSettled: cache.refresh,
  })

  return { create, update, remove, respond }
}

/**
 * Reads the mailboxes and calendars again when something may have changed elsewhere:
 * a mailbox connected or allowed in another window (the server pings the user's
 * channel), or the window coming back to the front (also without realtime).
 */
export function usePlanRefresh() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["plan"] })
    const stopWatching = watchChannel({
      fetchSubscription: () => api("/api/mail/realtime"),
      onChange: refresh,
    })
    // Only the list of calendars on focus: events refetch on their own timer.
    const onFocus = () => void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    window.addEventListener("focus", onFocus)
    return () => {
      stopWatching()
      window.removeEventListener("focus", onFocus)
    }
  }, [queryClient])
}

/** Sends the browser to Google or Microsoft to connect a mailbox with its calendars. */
export async function connectCalendar(provider: "gmail" | "outlook") {
  // Google and Microsoft send the browser back with a cookie session, which the
  // desktop app doesn't have: it is allowed on the web, and this window hears of it.
  if (isDesktop()) {
    window.open(appUrl("plan", "/"), "_blank")
    return
  }
  try {
    const { url } = await api<{ url: string }>(`/api/plan/connect/${provider}`, { method: "POST" })
    window.location.assign(url)
  } catch (error) {
    toast.error(errorText(error))
  }
}

/** The colour an event is drawn in: its calendar's, else its mailbox's. */
export function useEventColor(accounts: CalendarAccountView[] | undefined) {
  return useMemo(() => {
    const calendars = new Map<string, string>()
    for (const account of accounts ?? [])
      for (const calendar of account.calendars)
        calendars.set(calendarKey(account.id, calendar.id), calendar.color ?? accountColor(account.color))
    const fallback = new Map((accounts ?? []).map((account) => [account.id, accountColor(account.color)]))
    return (event: Pick<CalendarEvent, "accountId" | "calendarId">) =>
      calendars.get(calendarKey(event.accountId, event.calendarId)) ?? fallback.get(event.accountId) ?? ACCOUNT_COLORS[0]
  }, [accounts])
}
