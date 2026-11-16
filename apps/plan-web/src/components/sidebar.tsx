import { useState } from "react"
import { Add01Icon, Alert02Icon, ArrowLeft01Icon, ArrowRight01Icon, Calendar03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CalendarAccountView, CalendarEvent, CalendarView } from "@even/mail-core/calendar-types"
import { Button } from "@even/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@even/ui/components/dropdown-menu"
import { cn } from "@even/ui/lib/utils"
import { useI18n } from "@/i18n"
import { accountColor, calendarKey, connectCalendar, eventKey } from "@/lib/calendar"
import { addMonths, eventSpan, sameDay, startOfMonth, viewDays } from "@/lib/dates"
import { useNow } from "@/components/time-grid"

export function Brand() {
  return (
    <div className="brand">
      <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2.25} className="size-5" aria-hidden="true" />
      <span>
        Even plannen<span className="text-primary">.</span>
      </span>
    </div>
  )
}

/** The month at a glance; a day opens it. Shows its own month, which follows the main view. */
function MiniMonth({ date, days, onPick }: { date: Date; days: Date[]; onPick: (day: Date) => void }) {
  const { t, locale } = useI18n()
  const now = useNow()
  const [shown, setShown] = useState(() => startOfMonth(date))
  const [followed, setFollowed] = useState(date)
  // The main view moved to another month: this follows.
  if (followed !== date) {
    setFollowed(date)
    if (startOfMonth(date).getTime() !== shown.getTime()) setShown(startOfMonth(date))
  }
  const cells = viewDays("month", shown)
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(shown)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" })
  const inView = (day: Date) => days.some((other) => sameDay(other, day))
  return (
    <div className="plan-mini">
      <div className="plan-mini-head">
        <span className="plan-mini-title">{title}</span>
        <Button variant="ghost" size="icon-xs" aria-label={t.shell.previous} onClick={() => setShown(addMonths(shown, -1))}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={t.shell.next} onClick={() => setShown(addMonths(shown, 1))}>
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
      <div className="plan-mini-grid" role="grid">
        {cells.slice(0, 7).map((day) => (
          <span key={`h${day.getDay()}`} className="plan-mini-weekday" aria-hidden="true">
            {weekday.format(day)}
          </span>
        ))}
        {cells.map((day) => (
          <button
            key={day.toISOString()}
            type="button"
            className={cn(
              "plan-mini-day",
              day.getMonth() !== shown.getMonth() && "is-outside",
              inView(day) && "is-in-view",
              sameDay(day, now) && "is-today"
            )}
            aria-label={day.toLocaleDateString(locale, { dateStyle: "full" })}
            onClick={() => onPick(day)}
          >
            {day.getDate()}
          </button>
        ))}
      </div>
    </div>
  )
}

function AccountCalendars({
  account,
  isShown,
  onToggle,
}: {
  account: CalendarAccountView
  isShown: (calendar: CalendarView) => boolean
  onToggle: (calendar: CalendarView) => void
}) {
  const t = useI18n().t.sidebar
  return (
    <div className="plan-account">
      <div className="plan-account-email" title={account.email}>
        <span className="plan-dot" style={{ background: accountColor(account.color) }} aria-hidden="true" />
        <span className="truncate">{account.email}</span>
      </div>
      {account.state === "ok" &&
        account.calendars.map((calendar) => {
          const shown = isShown(calendar)
          return (
            <label key={calendarKey(account.id, calendar.id)} className="plan-calendar-toggle">
              <input
                type="checkbox"
                className="sr-only"
                checked={shown}
                onChange={() => onToggle(calendar)}
                aria-label={t.show(calendar.name)}
              />
              <span
                className={cn("plan-check", shown && "is-on")}
                style={{ ["--event" as string]: calendar.color ?? accountColor(account.color) }}
                aria-hidden="true"
              />
              <span className="truncate">{calendar.name}</span>
            </label>
          )
        })}
      {(account.state === "needs_access" || account.state === "reauth") && (
        <div className="plan-account-note">
          <p>{account.state === "reauth" ? t.reconnectHint : t.allowHint}</p>
          <Button size="xs" variant="outline" onClick={() => void connectCalendar(account.provider)}>
            {account.state === "reauth" ? t.reconnect : t.allow}
          </Button>
        </div>
      )}
      {account.state === "failed" && (
        <p className="plan-account-note">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mr-1 inline size-3.5" aria-hidden="true" />
          {t.failed}
        </p>
      )}
    </div>
  )
}

export function PlanSidebar({
  date,
  days,
  accounts,
  invitations,
  isShown,
  onToggle,
  onPickDay,
  onNewEvent,
  onOpenEvent,
  selectedKey,
}: {
  date: Date
  days: Date[]
  accounts: CalendarAccountView[]
  invitations: CalendarEvent[]
  isShown: (calendar: CalendarView) => boolean
  onToggle: (calendar: CalendarView) => void
  onPickDay: (day: Date) => void
  onNewEvent: () => void
  onOpenEvent: (event: CalendarEvent) => void
  selectedKey: string | null
}) {
  const { t, locale } = useI18n()
  const when = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" })
  return (
    <aside className="list-sidebar plan-sidebar max-lg:hidden!" aria-label={t.shell.sidebar}>
      <div className="sidebar-brand-row">
        <Brand />
      </div>
      <div className="list-navigation sidebar-sections">
        <div className="sidebar-top">
          <button type="button" className="list-link" aria-keyshortcuts="C" onClick={onNewEvent}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4 shrink-0" aria-hidden="true" />
            <span>{t.shell.newEvent}</span>
            <kbd className="nav-kbd">C</kbd>
          </button>
        </div>
        <MiniMonth date={date} days={days} onPick={onPickDay} />
        <section className="sidebar-list-section" aria-labelledby="plan-invitations">
          <div className="sidebar-heading">
            <h2 id="plan-invitations">{t.sidebar.invitations}</h2>
            {invitations.length > 0 && <span className="list-count">{invitations.length}</span>}
          </div>
          <div className="sidebar-section-links">
            {invitations.length === 0 ? (
              <p className="plan-sidebar-empty">{t.sidebar.noInvitations}</p>
            ) : (
              invitations.map((event) => (
                <button
                  key={eventKey(event)}
                  type="button"
                  className={cn("list-link plan-invite", selectedKey === eventKey(event) && "is-selected")}
                  onClick={() => onOpenEvent(event)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{event.title || t.shell.noTitle}</span>
                    <span className="plan-invite-when">{when.format(eventSpan(event).start)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
        <section className="sidebar-list-section" aria-labelledby="plan-calendars">
          <div className="sidebar-heading">
            <h2 id="plan-calendars">{t.sidebar.calendars}</h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="sidebar-add" aria-label={t.sidebar.addMailbox}>
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void connectCalendar("outlook")}>{t.sidebar.outlook}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void connectCalendar("gmail")}>{t.sidebar.gmail}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="plan-accounts">
            {accounts.map((account) => (
              <AccountCalendars key={account.id} account={account} isShown={isShown} onToggle={onToggle} />
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}
