import {
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@evido/ui/components/badge"
import { MessageInput, MessageRow } from "@/components/message-field"
import { useI18n } from "@/i18n"
import {
  isEmail,
  joinRecipients,
  splitRecipients,
  stripDisplayNames,
} from "@/lib/addresses"
import { api } from "@/lib/api"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@evido/ui/lib/utils"

type Contact = { name: string | null; email: string }

/** Matching contacts is a quick database lookup, so it can follow typing closely. */
const SUGGEST_DELAY_MS = 120

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

  // Suggestions come from people who wrote to this user; nothing leaves for a provider.
  const typed = useDebounced(draft.trim(), SUGGEST_DELAY_MS)
  const contacts = useQuery({
    queryKey: ["mail-contacts", typed],
    queryFn: () =>
      api<{ contacts: Contact[] }>(
        `/api/mail/contacts?q=${encodeURIComponent(typed)}`
      ),
    enabled: typed.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const suggestions =
    draft.trim() && !dismissed
      ? (contacts.data?.contacts ?? []).filter(
          (contact) => !entries.includes(contact.email)
        )
      : []
  const open = focused && suggestions.length > 0
  const listId = `${id}-suggestions`
  useEffect(() => {
    setActive(0)
    setDismissed(false)
  }, [draft])

  function choose(contact: Contact) {
    update(joinRecipients([...entries, contact.email]))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setActive(
          (current) =>
            (current + step + suggestions.length) % suggestions.length
        )
        return
      }
      const picked = suggestions[active]
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.metaKey &&
        !event.ctrlKey &&
        picked
      ) {
        event.preventDefault()
        choose(picked)
        return
      }
      if (event.key === "Escape") {
        // Handled here, so Escape closes the list and not the whole message.
        event.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      // Enter finishes the address; it shouldn't send a half written message.
      event.preventDefault()
      finishDraft()
    }
    if (event.key === "Backspace" && !draft && entries.length > 0)
      onChange(joinRecipients(entries.slice(0, -1)))
  }

  return (
    <div className="relative">
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
                  onClick={() =>
                    onChange(
                      joinRecipients(
                        entries.filter((item) => item !== entry),
                        draft
                      )
                    )
                  }
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="size-3"
                  />
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
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            onChange={(event) =>
              update(joinRecipients(entries, event.target.value))
            }
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false)
              finishDraft()
            }}
          />
        </span>
      </MessageRow>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t.suggestions}
          className="absolute top-full left-23 z-30 -mt-1 w-[min(22rem,calc(100%-6rem))] rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((contact, index) => (
            <li
              key={contact.email}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex cursor-pointer flex-col rounded-lg px-2.5 py-1.5 text-sm",
                index === active && "bg-accent text-accent-foreground"
              )}
              // Keeps focus in the field, so the click doesn't first finish the typed text.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(contact)}
            >
              <span className="truncate">{contact.name ?? contact.email}</span>
              {contact.name && (
                <span className="truncate text-xs text-muted-foreground">
                  {contact.email}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
