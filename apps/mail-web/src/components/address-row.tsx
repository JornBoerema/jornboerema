import { useId, type KeyboardEvent, type ReactNode } from "react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@evido/ui/components/badge"
import { MessageInput, MessageRow } from "@/components/message-field"
import { useI18n } from "@/i18n"
import { isEmail, joinRecipients, splitRecipients, stripDisplayNames } from "@/lib/addresses"

/**
 * Recipients as badges. The value stays one comma separated string: everything
 * before the last separator is a badge, the rest is what's still being typed.
 */
export function AddressRow({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  action,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  action?: ReactNode
}) {
  const t = useI18n().t.compose
  const id = useId()
  const { entries, draft } = splitRecipients(value)

  function update(next: string) {
    const parts = splitRecipients(stripDisplayNames(next))
    onChange(joinRecipients(parts.entries, parts.draft))
  }

  const finishDraft = () => {
    if (draft) update(joinRecipients([...entries, draft]))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      // Enter finishes the address; it shouldn't send a half written message.
      event.preventDefault()
      finishDraft()
    }
    if (event.key === "Backspace" && !draft && entries.length > 0)
      onChange(joinRecipients(entries.slice(0, -1)))
  }

  return (
    <MessageRow label={label} htmlFor={id} action={action}>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1.5">
        {entries.map((entry) => {
          const valid = isEmail(entry)
          return (
            <Badge
              key={entry}
              variant={valid ? "secondary" : "destructive"}
              title={valid ? entry : t.invalid(entry)}
              className="h-7 max-w-full gap-1 pr-1 pl-2.5 text-sm font-normal"
            >
              <span className="truncate">{entry}</span>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t.removeRecipient(entry)}
                className="flex size-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-foreground/10"
                onClick={() => onChange(joinRecipients(entries.filter((item) => item !== entry), draft))}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" className="size-3" />
              </button>
            </Badge>
          )
        })}
        <MessageInput
          id={id}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={entries.length === 0 ? placeholder : undefined}
          className="h-7 min-w-32"
          value={draft}
          onChange={(event) => update(joinRecipients(entries, event.target.value))}
          onKeyDown={onKeyDown}
          onBlur={finishDraft}
        />
      </span>
    </MessageRow>
  )
}
