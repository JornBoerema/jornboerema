import type { CalendarEvent } from "@even/mail-core/calendar-types"
import { useI18n } from "@/i18n"

/** What an event block in the time grid says: its title, then when and where. */
export function EventChip({ event, time }: { event: CalendarEvent; time: string }) {
  const t = useI18n().t.shell
  return (
    <span className="plan-event-body">
      <span className="plan-event-title">{event.title || t.noTitle}</span>
      <span className="plan-event-meta">
        {time}
        {event.location && <>, {event.location}</>}
      </span>
    </span>
  )
}
