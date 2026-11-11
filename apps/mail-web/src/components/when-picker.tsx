import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlarmClockIcon,
  Calendar03Icon,
  CalendarAdd01Icon,
  Coffee02Icon,
  MailSend01Icon,
  Moon02Icon,
  Sun03Icon,
  SunriseIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog"
import { cn } from "@evido/ui/lib/utils"
import { parseWhen } from "@evido/mail-core/when"
import { useI18n } from "@/i18n"

type Purpose = "snooze" | "send"
type Option = { key: string; icon: IconSvgElement; label: string; at: Date }

const at = (base: Date, days: number, hour: number, minute = 0) => {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  date.setHours(hour, minute, 0, 0)
  return date
}

const daysUntil = (now: Date, weekday: number) => (weekday - now.getDay() + 7) % 7 || 7

/** Moments people pick most, worked out from now so each shows its real day and time. */
function quickPicks(purpose: Purpose, now: Date, t: ReturnType<typeof useI18n>["t"]["later"]): Option[] {
  const options: Option[] = []
  if (purpose === "snooze") {
    const later = new Date(now)
    later.setHours(later.getHours() + 3, 0, 0, 0)
    if (later.getDate() === now.getDate() && later.getHours() <= 21)
      options.push({ key: "later", icon: Coffee02Icon, label: t.laterToday, at: later })
    if (now.getHours() < 19) options.push({ key: "tonight", icon: Moon02Icon, label: t.tonight, at: at(now, 0, 20) })
    options.push({ key: "tomorrow", icon: SunriseIcon, label: t.tomorrow, at: at(now, 1, 8) })
    const weekend = now.getDay() === 6 ? 7 : daysUntil(now, 6)
    options.push({ key: "weekend", icon: Sun03Icon, label: t.thisWeekend, at: at(now, weekend, 9) })
    options.push({ key: "week", icon: CalendarAdd01Icon, label: t.nextWeek, at: at(now, daysUntil(now, 1), 8) })
  } else {
    options.push({ key: "morning", icon: SunriseIcon, label: t.tomorrowMorning, at: at(now, 1, 8) })
    options.push({ key: "afternoon", icon: Sun03Icon, label: t.tomorrowAfternoon, at: at(now, 1, 13) })
    options.push({ key: "monday", icon: CalendarAdd01Icon, label: t.mondayMorning, at: at(now, daysUntil(now, 1), 8) })
  }
  return options
}

/**
 * When to snooze to, or send at: a small spotlight. Type a moment in your own
 * words and it shows, right away, the day and time it understood; or pick one
 * of the usual moments, each with its real day and time beside it.
 */
export function WhenPicker({
  open,
  onOpenChange,
  purpose,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  purpose: Purpose
  onPick: (at: Date) => void
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.later
  const [text, setText] = useState("")
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  // "Now" as the picker opened, so the picks don't shift while it is open.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!open) return
    setNow(new Date())
    setText("")
    setActive(0)
  }, [open])

  const picks = useMemo(() => quickPicks(purpose, now, t), [purpose, now, t])
  const typed = text.trim() ? parseWhen(text, new Date()) : null
  const options: Option[] = typed ? [{ key: "typed", icon: Calendar03Icon, label: "", at: typed }, ...picks] : picks
  const choose = (option: Option | undefined) => {
    if (!option) return
    onPick(option.at)
    onOpenChange(false)
  }

  const day = (date: Date) => {
    const sameWeek = (date.getTime() - now.getTime()) / 86_400_000 < 6
    return date.toLocaleDateString(locale, sameWeek ? { weekday: "short" } : { day: "numeric", month: "short" })
  }
  const time = (date: Date) => date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  const title = purpose === "snooze" ? t.snoozeUntil : t.sendAt

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="list-spotlight when-picker"
        style={{ translate: "-50% 0" }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          input.current?.focus()
        }}
      >
        <DialogTitle className="flex items-center gap-2 px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
          <HugeiconsIcon
            icon={purpose === "snooze" ? AlarmClockIcon : MailSend01Icon}
            strokeWidth={1.75}
            aria-hidden="true"
            className="size-3.5"
          />
          {title}
        </DialogTitle>
        <DialogDescription className="sr-only">{t.help}</DialogDescription>

        <div className="when-picker-field">
          <HugeiconsIcon icon={Calendar03Icon} strokeWidth={1.75} aria-hidden="true" className="size-4.5 shrink-0" />
          <input
            ref={input}
            value={text}
            placeholder={t.placeholder}
            aria-label={t.help}
            aria-controls="when-options"
            aria-activedescendant={options[active] ? `when-${options[active].key}` : undefined}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            onChange={(event) => {
              setText(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setActive((index) => Math.min(index + 1, options.length - 1))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setActive((index) => Math.max(index - 1, 0))
              } else if (event.key === "Enter") {
                event.preventDefault()
                choose(options[active])
              }
            }}
          />
        </div>

        {/* What the words mean, as they are typed. */}
        {text.trim() && !typed && <p className="px-3 pt-3 pb-1 text-sm text-muted-foreground">{t.notUnderstood}</p>}

        <ul id="when-options" role="listbox" aria-label={title} className="flex flex-col gap-0.5 pt-2">
          {options.map((option, index) => {
            const isTyped = option.key === "typed"
            return (
              <li key={option.key}>
                {index === 1 && typed && <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{t.quick}</p>}
                <button
                  id={`when-${option.key}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cn("when-option", index === active && "is-active", isTyped && "is-typed")}
                >
                  <HugeiconsIcon icon={option.icon} strokeWidth={1.75} aria-hidden="true" className="size-4 shrink-0" />
                  {isTyped ? (
                    <span className="min-w-0 flex-1 truncate font-medium first-letter:uppercase">
                      {option.at.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  )}
                  {!isTyped && <span className="when-day">{day(option.at)}</span>}
                  <span className="when-time">{time(option.at)}</span>
                  {index === active && <kbd className="when-enter">↵</kbd>}
                </button>
              </li>
            )
          })}
        </ul>
        <p className="spotlight-help">
          <span>↑↓</span>
          <span>↵ {t.pick}</span>
          <span>esc</span>
        </p>
      </DialogContent>
    </Dialog>
  )
}
