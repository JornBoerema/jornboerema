import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import {
  Cancel01Icon,
  Clock01Icon,
  Delete02Icon,
  LinkSquare02Icon,
  Location01Icon,
  PencilEdit02Icon,
  RepeatIcon,
  TextIcon,
  UserGroupIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type {
  CalendarAccountView,
  CalendarAttendee,
  CalendarEvent,
  CalendarEventInput,
  CalendarPerson,
  CalendarRepeat,
} from "@even/mail-core/calendar-types"
import { CALENDAR_REPEATS } from "@even/mail-core/calendar-types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@even/ui/components/alert-dialog"
import { Button } from "@even/ui/components/button"
import { Input } from "@even/ui/components/input"
import { Label } from "@even/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@even/ui/components/select"
import { Switch } from "@even/ui/components/switch"
import { Textarea } from "@even/ui/components/textarea"
import { cn } from "@even/ui/lib/utils"
import { useI18n } from "@/i18n"
import { accountColor, calendarKey, refOf, useEventActions } from "@/lib/calendar"
import { addDays, clockKey, dayKey, eventSpan, fromDayKey, fromParts, localTimeZone, wallTime } from "@/lib/dates"

/** What the panel on the right shows: an event, or a form for a new or changed one. */
export type PanelState =
  | { mode: "view"; event: CalendarEvent }
  | { mode: "create"; start: Date; end: Date; allDay: boolean }
  | { mode: "edit"; event: CalendarEvent }

function Row({ icon, children }: { icon: IconSvgElement; children: React.ReactNode }) {
  return (
    <div className="plan-detail-row">
      <HugeiconsIcon icon={icon} strokeWidth={2} className="plan-detail-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** "Monday 16 November, 09:00 – 10:00", or the days of an all-day event. */
export function useWhen() {
  const { locale } = useI18n()
  return (event: Pick<CalendarEvent, "start" | "end" | "allDay">) => {
    const { start, end } = eventSpan(event)
    const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" })
    const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })
    if (event.allDay) {
      const last = addDays(end, -1)
      return last > start ? `${date.format(start)} – ${date.format(last)}` : date.format(start)
    }
    if (dayKey(start) === dayKey(end)) return `${date.format(start)}, ${time.format(start)} – ${time.format(end)}`
    return `${date.format(start)} ${time.format(start)} – ${date.format(end)} ${time.format(end)}`
  }
}

export function EventDetails({
  event,
  accounts,
  color,
  onEdit,
  onClose,
}: {
  event: CalendarEvent
  accounts: CalendarAccountView[]
  color: string
  onEdit: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const when = useWhen()
  const actions = useEventActions()
  const [deleting, setDeleting] = useState(false)
  const account = accounts.find((candidate) => candidate.id === event.accountId)
  const calendar = account?.calendars.find((candidate) => candidate.id === event.calendarId)
  const answers = [
    { value: "accepted", label: t.event.accept },
    { value: "tentative", label: t.event.tentative },
    { value: "declined", label: t.event.decline },
  ] as const
  const responseLabel: Record<CalendarAttendee["response"], string> = {
    accepted: t.event.accepted,
    declined: t.event.declined,
    tentative: t.event.tentativeState,
    needsAction: t.event.noAnswer,
  }
  const remove = (series: boolean) => {
    actions.remove.mutate({ ref: refOf(event), series })
    setDeleting(false)
    onClose()
  }
  const cancels = event.isOrganizer && event.attendees.length > 0

  return (
    <div className="plan-panel-inner">
      <div className="plan-panel-actions">
        {event.canEdit && (
          <Button variant="ghost" size="icon-sm" aria-label={t.event.edit} title={t.event.edit} onClick={onEdit}>
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={event.isOrganizer ? t.event.delete : t.event.remove}
          title={event.isOrganizer ? t.event.delete : t.event.remove}
          onClick={() => setDeleting(true)}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t.event.close} title={t.event.close} onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
      <h2 className="plan-detail-title" style={{ ["--event" as string]: color }}>
        {event.title || t.shell.noTitle}
      </h2>
      <Row icon={Clock01Icon}>
        <p>{when(event)}</p>
        {event.recurring && (
          <p className="plan-detail-quiet">
            <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} className="mr-1 inline size-3.5" aria-hidden="true" />
            {t.event.repeats}
          </p>
        )}
      </Row>
      {event.meetingUrl && (
        <Row icon={Video01Icon}>
          <Button asChild size="sm">
            <a href={event.meetingUrl} target="_blank" rel="noreferrer">
              {t.event.join}
            </a>
          </Button>
        </Row>
      )}
      {event.location && (
        <Row icon={Location01Icon}>
          <p className="break-words">{event.location}</p>
        </Row>
      )}
      {event.myResponse && (
        <div className="plan-rsvp">
          <span>{t.event.yourAnswer}</span>
          <div className="plan-rsvp-buttons" role="group" aria-label={t.event.yourAnswer}>
            {answers.map((answer) => (
              <Button
                key={answer.value}
                size="sm"
                variant={event.myResponse === answer.value ? "default" : "outline"}
                aria-pressed={event.myResponse === answer.value}
                disabled={actions.respond.isPending}
                onClick={() => actions.respond.mutate({ ref: refOf(event), answer: answer.value })}
              >
                {answer.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {event.attendees.length > 0 && (
        <Row icon={UserGroupIcon}>
          <p className="plan-detail-quiet mb-1">{t.event.guests}</p>
          <ul className="plan-guests">
            {event.attendees.map((attendee) => (
              <li key={attendee.email}>
                <span className={cn("plan-guest-dot", `is-${attendee.response}`)} title={responseLabel[attendee.response]} />
                <span className="min-w-0 flex-1 truncate" title={attendee.email}>
                  {attendee.name || attendee.email}
                  {attendee.self && <span className="plan-detail-quiet"> ({t.event.you})</span>}
                </span>
                <span className="plan-detail-quiet shrink-0">
                  {attendee.organizer ? t.event.organizer : attendee.optional ? t.event.optional : ""}
                </span>
              </li>
            ))}
          </ul>
        </Row>
      )}
      {event.description && (
        <Row icon={TextIcon}>
          <p className="plan-description">{event.description}</p>
        </Row>
      )}
      <div className="plan-detail-foot">
        <span className="plan-detail-calendar">
          <span className="plan-dot" style={{ background: color }} aria-hidden="true" />
          <span className="truncate">{calendar?.name ?? account?.email}</span>
        </span>
        {event.webLink && (
          <a className="plan-detail-link" href={event.webLink} target="_blank" rel="noreferrer">
            {t.event.openIn(account?.provider === "gmail" ? "Google" : "Outlook")}
            <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{event.recurring ? t.event.deleteSeriesTitle : t.event.deleteTitle}</AlertDialogTitle>
            {cancels && <AlertDialogDescription>{t.event.deleteBody}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.event.cancel}</AlertDialogCancel>
            {event.recurring && (
              <AlertDialogAction variant="outline" onClick={() => remove(true)}>
                {t.event.deleteAll}
              </AlertDialogAction>
            )}
            <AlertDialogAction variant="destructive" onClick={() => remove(false)}>
              {event.recurring ? t.event.deleteOnly : event.isOrganizer ? t.event.delete : t.event.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const LAST_CALENDAR = "even.plan.calendar"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The guests of an event as the API takes them back: everyone but the mailbox itself. */
export const guestsOf = (event: CalendarEvent): CalendarPerson[] =>
  event.attendees.filter((attendee) => !attendee.self).map(({ email, name }) => ({ email, name }))

/** An event's fields with a new time, for moving it in the grid. */
export function movedInput(event: CalendarEvent, start: Date, end: Date): CalendarEventInput {
  return {
    title: event.title,
    start: wallTime(start),
    end: wallTime(end),
    allDay: false,
    timeZone: localTimeZone(),
    location: event.location ?? "",
    description: event.description ?? "",
    attendees: guestsOf(event),
  }
}

export function EventForm({
  state,
  accounts,
  onDone,
}: {
  state: Extract<PanelState, { mode: "create" | "edit" }>
  accounts: CalendarAccountView[]
  onDone: (saved: CalendarEvent | null) => void
}) {
  const { t } = useI18n()
  const actions = useEventActions()
  const editing = state.mode === "edit" ? state.event : null
  const writable = useMemo(
    () =>
      accounts.flatMap((account) =>
        account.calendars.filter((calendar) => calendar.canEdit).map((calendar) => ({ account, calendar }))
      ),
    [accounts]
  )
  const [target, setTarget] = useState(() => {
    if (editing) return calendarKey(editing.accountId, editing.calendarId)
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_CALENDAR)
    } catch {
      // The main calendar then.
    }
    const keys = writable.map(({ calendar }) => calendarKey(calendar.accountId, calendar.id))
    if (last && keys.includes(last)) return last
    const primary = writable.find(({ calendar }) => calendar.primary)?.calendar
    return primary ? calendarKey(primary.accountId, primary.id) : (keys[0] ?? "")
  })

  const initial = editing ? eventSpan(editing) : { start: state.mode === "create" ? state.start : new Date(), end: state.mode === "create" ? state.end : new Date() }
  const initialAllDay = editing ? editing.allDay : state.mode === "create" && state.allDay
  const [title, setTitle] = useState(editing?.title ?? "")
  const [allDay, setAllDay] = useState(initialAllDay)
  const [startDay, setStartDay] = useState(dayKey(initial.start))
  const [startClock, setStartClock] = useState(initialAllDay ? "09:00" : clockKey(initial.start))
  // All-day events end the day after; the form shows the last day.
  const [endDay, setEndDay] = useState(dayKey(initialAllDay ? addDays(initial.end, -1) : initial.end))
  const [endClock, setEndClock] = useState(initialAllDay ? "10:00" : clockKey(initial.end))
  const [repeat, setRepeat] = useState<CalendarRepeat>("none")
  const [location, setLocation] = useState(editing?.location ?? "")
  const [description, setDescription] = useState(editing?.description ?? "")
  const [guests, setGuests] = useState<CalendarPerson[]>(editing ? guestsOf(editing) : [])
  const [guestInput, setGuestInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => titleRef.current?.focus(), [])

  const start = allDay ? fromDayKey(startDay) : fromParts(startDay, startClock)
  const end = allDay ? addDays(fromDayKey(endDay), 1) : fromParts(endDay, endClock)

  /** Moving the start takes the end along, so the length stays. */
  function changeStart(day: string, clock: string) {
    const length = end.getTime() - start.getTime()
    const next = allDay ? fromDayKey(day) : fromParts(day, clock)
    const nextEnd = new Date(next.getTime() + Math.max(length, 0))
    setStartDay(day)
    setStartClock(clock)
    setEndDay(dayKey(allDay ? addDays(nextEnd, -1) : nextEnd))
    if (!allDay) setEndClock(clockKey(nextEnd))
  }

  function addGuests(raw: string) {
    const values = raw.split(/[\s,;]+/).filter(Boolean)
    const wrong = values.find((value) => !EMAIL.test(value))
    if (wrong) {
      setError(t.form.invalidEmail(wrong))
      return false
    }
    setGuests((current) => [
      ...current,
      ...values
        .filter((value) => !current.some((guest) => guest.email.toLowerCase() === value.toLowerCase()))
        .map((email) => ({ email, name: null })),
    ])
    setGuestInput("")
    setError(null)
    return true
  }

  function onGuestKey(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === "," || event.key === "Tab") && guestInput.trim()) {
      event.preventDefault()
      addGuests(guestInput)
    } else if (event.key === "Backspace" && !guestInput && guests.length > 0) setGuests(guests.slice(0, -1))
  }

  const busy = actions.create.isPending || actions.update.isPending

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (guestInput.trim() && !addGuests(guestInput)) return
    if (end < start) {
      setError(t.form.endBeforeStart)
      return
    }
    const chosen = writable.find(({ calendar }) => calendarKey(calendar.accountId, calendar.id) === target)
    if (!chosen && !editing) {
      setError(t.form.noCalendar)
      return
    }
    const pending = guestInput.trim() ? guestInput.split(/[\s,;]+/).filter(Boolean).map((email) => ({ email, name: null })) : []
    const input: CalendarEventInput = {
      title: title.trim(),
      start: allDay ? startDay : wallTime(start),
      end: allDay ? dayKey(end) : wallTime(end),
      allDay,
      timeZone: localTimeZone(),
      location: location.trim(),
      description,
      attendees: [...guests, ...pending.filter((person) => !guests.some((guest) => guest.email === person.email))],
      ...(!editing && { repeat }),
    }
    try {
      if (editing) {
        const optimistic: CalendarEvent = {
          ...editing,
          title: input.title,
          location: input.location || null,
          description: input.description || null,
          allDay,
          start: allDay ? input.start : start.toISOString(),
          end: allDay ? input.end : end.toISOString(),
        }
        const { event: saved } = await actions.update.mutateAsync({ ref: refOf(editing), event: input, optimistic })
        onDone(saved ?? optimistic)
      } else {
        try {
          localStorage.setItem(LAST_CALENDAR, target)
        } catch {
          // Not remembered then.
        }
        const { event: saved } = await actions.create.mutateAsync({
          target: { accountId: chosen!.calendar.accountId, calendarId: chosen!.calendar.id },
          event: input,
        })
        onDone(saved)
      }
    } catch {
      // The toast says what went wrong; the form stays as it was.
    }
  }

  return (
    <form
      className="plan-panel-inner plan-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit()
        if (event.key === "Escape") onDone(null)
      }}
    >
      <div className="plan-panel-actions">
        <span className="plan-form-heading">{editing ? t.form.editTitle : t.form.newTitle}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t.form.cancel} onClick={() => onDone(null)}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
      <Input
        ref={titleRef}
        className="plan-form-title"
        aria-label={t.form.title}
        placeholder={t.form.titlePlaceholder}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      {editing?.recurring && <p className="plan-detail-quiet">{t.form.seriesNote}</p>}

      <div className="plan-field">
        <Label htmlFor="plan-calendar">{t.form.calendar}</Label>
        <Select value={target} onValueChange={setTarget} disabled={Boolean(editing)}>
          <SelectTrigger id="plan-calendar" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {writable.map(({ account, calendar }) => (
              <SelectItem key={calendarKey(calendar.accountId, calendar.id)} value={calendarKey(calendar.accountId, calendar.id)}>
                <span className="plan-dot" style={{ background: calendar.color ?? accountColor(account.color) }} aria-hidden="true" />
                <span className="truncate">
                  {calendar.name}
                  {accounts.length > 1 && <span className="text-muted-foreground"> · {account.email}</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="plan-field-inline">
        <Label htmlFor="plan-allday">{t.form.allDay}</Label>
        <Switch id="plan-allday" checked={allDay} onCheckedChange={setAllDay} />
      </div>

      <div className="plan-field">
        <Label htmlFor="plan-start">{t.form.starts}</Label>
        <div className="plan-when">
          <Input id="plan-start" type="date" required value={startDay} onChange={(event) => event.target.value && changeStart(event.target.value, startClock)} />
          {!allDay && (
            <Input type="time" step={300} required aria-label={t.form.starts} value={startClock} onChange={(event) => event.target.value && changeStart(startDay, event.target.value)} />
          )}
        </div>
      </div>
      <div className="plan-field">
        <Label htmlFor="plan-end">{t.form.ends}</Label>
        <div className="plan-when">
          <Input id="plan-end" type="date" required value={endDay} onChange={(event) => event.target.value && setEndDay(event.target.value)} />
          {!allDay && (
            <Input type="time" step={300} required aria-label={t.form.ends} value={endClock} onChange={(event) => event.target.value && setEndClock(event.target.value)} />
          )}
        </div>
      </div>

      {!editing && (
        <div className="plan-field">
          <Label htmlFor="plan-repeat">{t.form.repeat}</Label>
          <Select value={repeat} onValueChange={(value) => setRepeat(value as CalendarRepeat)}>
            <SelectTrigger id="plan-repeat" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CALENDAR_REPEATS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t.form.repeats[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="plan-field">
        <Label htmlFor="plan-location">{t.form.location}</Label>
        <Input id="plan-location" placeholder={t.form.locationPlaceholder} value={location} onChange={(event) => setLocation(event.target.value)} />
      </div>

      <div className="plan-field">
        <Label htmlFor="plan-guests">{t.form.guests}</Label>
        <div className="plan-guest-input">
          {guests.map((guest) => (
            <span key={guest.email} className="plan-guest-token">
              <span className="truncate">{guest.name || guest.email}</span>
              <button
                type="button"
                aria-label={t.form.removeGuest(guest.email)}
                onClick={() => setGuests(guests.filter((other) => other.email !== guest.email))}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            id="plan-guests"
            type="email"
            multiple
            autoComplete="off"
            placeholder={guests.length === 0 ? t.form.guestsPlaceholder : undefined}
            value={guestInput}
            onChange={(event) => setGuestInput(event.target.value)}
            onKeyDown={onGuestKey}
            onBlur={() => guestInput.trim() && addGuests(guestInput)}
          />
        </div>
      </div>

      <div className="plan-field">
        <Label htmlFor="plan-description">{t.form.description}</Label>
        <Textarea
          id="plan-description"
          rows={4}
          placeholder={t.form.descriptionPlaceholder}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="plan-form-foot">
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          {t.form.cancel}
        </Button>
        <Button type="submit" disabled={busy}>
          {editing ? t.form.save : t.form.create}
          <kbd className="plan-kbd">⌘↵</kbd>
        </Button>
      </div>
    </form>
  )
}
