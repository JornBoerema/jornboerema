import { useCallback, useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft01Icon, ArrowRight01Icon, Calendar03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CalendarEvent } from "@even/mail-core/calendar-types"
import { Button } from "@even/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@even/ui/components/empty"
import { Spinner } from "@even/ui/components/spinner"
import { useAppSwitcher } from "@even/ui/components/app-switcher"
import { cn } from "@even/ui/lib/utils"
import { EventDetails, EventForm, movedInput, type PanelState } from "@/components/event-panel"
import { MonthGrid } from "@/components/month-grid"
import { PlanSidebar } from "@/components/sidebar"
import { TimeGrid } from "@/components/time-grid"
import { useI18n } from "@/i18n"
import { ApiError } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import {
  connectCalendar,
  eventKey,
  refOf,
  useCalendarAccounts,
  useEventActions,
  useEventColor,
  useEvents,
  useShownCalendars,
} from "@/lib/calendar"
import { addDays, addMinutes, startOfDay, stepView, viewDays, type ViewKind } from "@/lib/dates"

const VIEW_KEY = "even.plan.view"

function storedView(): ViewKind {
  try {
    const value = localStorage.getItem(VIEW_KEY)
    if (value === "day" || value === "week" || value === "month") return value
  } catch {
    // Week then.
  }
  return "week"
}

/** ISO week number: the week with the year's first Thursday is week 1. */
function isoWeek(date: Date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7))
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1)
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7)
}

/** Typing in a field (or a dialog being open) keeps the letters for the field. */
function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]"))
}

/** A Google or Microsoft connect flow came back here: say how it went, then clear the address. */
function useConnectResult() {
  const t = useI18n().t.connect
  const queryClient = useQueryClient()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get("error")
    if (!params.has("connected") && !error) return
    if (params.has("connected")) {
      toast.success(t.connected)
      void queryClient.invalidateQueries({ queryKey: ["plan"] })
    } else toast.error(error === "denied" ? t.denied : error === "admin_consent" ? t.adminConsent : t.failed)
    window.history.replaceState(window.history.state, "", window.location.pathname)
  }, [queryClient, t])
}

/** Even plannen comes with Even mailen: the same invitation or subscription lets you in. */
function NoAccess() {
  const t = useI18n().t.empty
  const switcher = useAppSwitcher()
  return (
    <Empty className="plan-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t.noAccessTitle}</EmptyTitle>
        <EmptyDescription>{t.noAccessBody}</EmptyDescription>
      </EmptyHeader>
      {switcher && (
        <EmptyContent>
          <Button onClick={() => switcher.onSelect("mail")}>{t.openMail}</Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

function NoCalendars({ allow }: { allow: { provider: "gmail" | "outlook" }[] }) {
  const t = useI18n().t.empty
  return (
    <Empty className="plan-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{allow.length > 0 ? t.allowTitle : t.title}</EmptyTitle>
        <EmptyDescription>{allow.length > 0 ? t.allowBody : t.body}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => void connectCalendar("outlook")}>{t.outlook}</Button>
          <Button variant="outline" onClick={() => void connectCalendar("gmail")}>
            {t.google}
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  )
}

function PlanApp() {
  const { t, locale } = useI18n()
  useConnectResult()
  const [kind, setKindState] = useState<ViewKind>(storedView)
  const [date, setDate] = useState(() => startOfDay(new Date()))
  const [panel, setPanel] = useState<PanelState | null>(null)
  const setKind = useCallback((next: ViewKind) => {
    setKindState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Week again next time.
    }
  }, [])

  const accountsQuery = useCalendarAccounts()
  const accounts = useMemo(() => accountsQuery.data?.accounts ?? [], [accountsQuery.data])
  const readable = accounts.some((account) => account.state === "ok")
  const { isShown, toggle, hidden } = useShownCalendars(accounts)
  const color = useEventColor(accounts)
  const actions = useEventActions()

  const days = useMemo(() => viewDays(kind, date), [kind, date])
  const from = days[0]!
  const to = addDays(days[days.length - 1]!, 1)
  const eventsQuery = useEvents(from, to, hidden, readable)
  const events = eventsQuery.data?.events ?? []

  // Invitations still to answer, from today on.
  const today = startOfDay(new Date())
  const invitationsQuery = useEvents(today, addDays(today, 60), hidden, readable)
  const invitations = useMemo(
    () => (invitationsQuery.data?.events ?? []).filter((event) => event.myResponse === "needsAction"),
    [invitationsQuery.data]
  )

  // The panel shows the newest version of its event, once a read brings one.
  const shownEvent = useMemo(() => {
    if (!panel || panel.mode === "create") return null
    const key = eventKey(panel.event)
    return [...events, ...(invitationsQuery.data?.events ?? [])].find((event) => eventKey(event) === key) ?? panel.event
  }, [panel, events, invitationsQuery.data])
  const selectedKey = shownEvent ? eventKey(shownEvent) : null

  const openDay = useCallback(
    (day: Date) => {
      setDate(startOfDay(day))
      setKind("day")
    },
    [setKind]
  )
  const newEvent = useCallback(() => {
    const start = new Date()
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0)
    // Today's next half hour, or nine o'clock on the day in view.
    const begin = kind === "day" && startOfDay(date).getTime() !== startOfDay(new Date()).getTime() ? addMinutes(date, 9 * 60) : start
    setPanel({ mode: "create", start: begin, end: addMinutes(begin, 60), allDay: false })
  }, [kind, date])

  const reschedule = useCallback(
    (event: CalendarEvent, start: Date, end: Date) => {
      const optimistic = { ...event, start: start.toISOString(), end: end.toISOString() }
      actions.update.mutate({ ref: refOf(event), event: movedInput(event, start, end), optimistic })
    },
    [actions.update]
  )

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const key = event.key.toLowerCase()
      const handled = (() => {
        if (key === "escape" && panel) return setPanel(null), true
        if (key === "t") return setDate(startOfDay(new Date())), true
        if (key === "d") return setKind("day"), true
        if (key === "w") return setKind("week"), true
        if (key === "m") return setKind("month"), true
        if (key === "c" || key === "n") return newEvent(), true
        if (key === "arrowleft" || key === "k" || key === "p") return setDate((current) => stepView(kind, current, -1)), true
        if (key === "arrowright" || key === "j") return setDate((current) => stepView(kind, current, 1)), true
        return false
      })()
      if (handled) event.preventDefault()
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [kind, panel, newEvent, setKind])

  const title =
    kind === "day"
      ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)
      : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(kind === "week" ? days[3]! : date)
  const failed = (eventsQuery.data?.failed.length ?? 0) > 0
  const needsAccess = accounts.filter((account) => account.state === "needs_access" || account.state === "reauth")
  const views: { kind: ViewKind; label: string; key: string }[] = [
    { kind: "day", label: t.shell.day, key: "D" },
    { kind: "week", label: t.shell.week, key: "W" },
    { kind: "month", label: t.shell.month, key: "M" },
  ]

  return (
    <div className="workspace-shell plan-shell max-lg:grid-cols-[minmax(0,1fr)]!">
      <PlanSidebar
        date={date}
        days={kind === "month" ? [] : days}
        accounts={accounts}
        invitations={invitations}
        isShown={isShown}
        onToggle={toggle}
        onPickDay={(day) => setDate(startOfDay(day))}
        onNewEvent={newEvent}
        onOpenEvent={(event) => {
          setDate(startOfDay(new Date(event.allDay ? `${event.start}T00:00` : event.start)))
          setPanel({ mode: "view", event })
        }}
        selectedKey={selectedKey}
      />
      <main className="plan-main">
        <header className="plan-toolbar">
          <div className="plan-toolbar-nav">
            <Button variant="outline" size="sm" aria-keyshortcuts="T" onClick={() => setDate(startOfDay(new Date()))}>
              {t.shell.today}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.shell.previous}
              onClick={() => setDate(stepView(kind, date, -1))}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t.shell.next} onClick={() => setDate(stepView(kind, date, 1))}>
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden="true" />
            </Button>
            <h1 className="plan-title">{title}</h1>
            {kind === "week" && <span className="plan-week">{t.shell.weekNumber(isoWeek(date))}</span>}
            {eventsQuery.isFetching && <Spinner className="size-3.5 text-muted-foreground" />}
          </div>
          <div className="plan-views" role="radiogroup" aria-label={t.shell.views}>
            {views.map((view) => (
              <button
                key={view.kind}
                type="button"
                role="radio"
                aria-checked={kind === view.kind}
                aria-keyshortcuts={view.key}
                title={`${view.label} (${view.key})`}
                className={cn("plan-view", kind === view.kind && "is-active")}
                onClick={() => setKind(view.kind)}
              >
                {view.label}
              </button>
            ))}
          </div>
        </header>
        {failed && <p className="plan-notice">{t.shell.someFailed}</p>}
        <div className={cn("plan-body", panel && "has-panel")}>
          <div className="plan-view-area">
            {accountsQuery.isPending ? (
              <div className="plan-loading">
                <Spinner />
                <span>{t.shell.loading}</span>
              </div>
            ) : isNoAccess(accountsQuery.error) ? (
              <NoAccess />
            ) : !readable ? (
              <NoCalendars allow={needsAccess} />
            ) : kind === "month" ? (
              <MonthGrid
                days={days}
                month={date.getMonth()}
                events={events}
                color={color}
                selectedKey={selectedKey}
                onSelect={(event) => setPanel({ mode: "view", event })}
                onCreate={(start, end, allDay) => setPanel({ mode: "create", start, end, allDay })}
                onOpenDay={openDay}
              />
            ) : (
              <TimeGrid
                key={kind}
                days={days}
                events={events}
                color={color}
                selectedKey={selectedKey}
                onSelect={(event) => setPanel({ mode: "view", event })}
                onCreate={(start, end, allDay) => setPanel({ mode: "create", start, end, allDay })}
                onReschedule={reschedule}
                onOpenDay={openDay}
              />
            )}
          </div>
          {panel && (
            <aside className="plan-panel" aria-label={panel.mode === "view" ? shownEvent?.title : t.form.newTitle}>
              {panel.mode === "view" && shownEvent ? (
                <EventDetails
                  key={selectedKey}
                  event={shownEvent}
                  accounts={accounts}
                  color={color(shownEvent)}
                  onEdit={() => setPanel({ mode: "edit", event: shownEvent })}
                  onClose={() => setPanel(null)}
                />
              ) : panel.mode !== "view" ? (
                <EventForm
                  key={panel.mode === "edit" ? `edit:${selectedKey}` : `new:${panel.start.toISOString()}`}
                  state={panel.mode === "edit" && shownEvent ? { mode: "edit", event: shownEvent } : panel}
                  accounts={accounts}
                  onDone={(saved) =>
                    setPanel(
                      saved ? { mode: "view", event: saved } : panel.mode === "edit" ? { mode: "view", event: panel.event } : null
                    )
                  }
                />
              ) : null}
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}

/** Even plannen once signed in; the shell handles signing in, so a lost session reloads. */
export function Root() {
  const { data, isPending, error } = authClient.useSession()
  useEffect(() => {
    if (!isPending && !data && !error) window.location.reload()
  }, [data, isPending, error])
  if (!data) return null
  return <PlanApp />
}

const isNoAccess = (error: unknown) => error instanceof ApiError && error.status === 403 && Boolean(error.body?.noAccess)
