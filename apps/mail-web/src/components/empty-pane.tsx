import { useI18n } from "@/i18n"
import { useUnread } from "@/lib/mail"

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border bg-background px-1.5 font-sans text-[11px] font-medium text-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

/**
 * The reading pane with nothing open: where the day stands, and the keys that
 * move through mail fastest. No illustration, in keeping with the rest.
 */
export function EmptyPane() {
  const { t: strings, locale } = useI18n()
  const t = strings.emptyPane
  const unread = useUnread(true).data?.count
  const today = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date())
  const shortcuts = [
    { keys: ["J", "K"], label: t.browse },
    { keys: ["C"], label: t.compose },
    { keys: [IS_MAC ? "⌘" : "Ctrl", "K"], label: t.search },
    { keys: ["E"], label: t.archive },
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-xs flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-xl font-semibold tracking-tight first-letter:uppercase">{today}</p>
          <p className="text-sm text-muted-foreground">
            {unread === undefined ? " " : unread === 0 ? t.allRead : t.unread(unread.toLocaleString(locale))}
          </p>
        </div>
        <ul className="flex flex-col gap-2.5 border-t pt-5 text-sm text-muted-foreground" aria-label={t.shortcuts}>
          {shortcuts.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center justify-between gap-4">
              <span>{shortcut.label}</span>
              <Keys keys={shortcut.keys} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
