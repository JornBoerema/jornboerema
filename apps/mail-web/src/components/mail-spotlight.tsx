import { useEffect, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import {
  Attachment01Icon,
  File01Icon,
  InboxIcon,
  PencilEdit02Icon,
  Mail01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@evido/ui/components/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog"
import { Spinner } from "@evido/ui/components/spinner"
import { cn } from "@evido/ui/lib/utils"
import type { MailAccountView, MailSearchHit, MailThreadView } from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { searchHitAsThread } from "@/lib/mail"

/** Searching goes to every mailbox, so it waits for a pause in typing. */
const SEARCH_DELAY_MS = 300
const MIN_QUERY = 2

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase()

function useDebounced(value: string) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [value])
  return settled
}

type SpotlightCommand = { id: string; label: string; icon?: IconSvgElement; account?: MailAccountView; run: () => void }

export function MailSpotlight({
  open,
  onOpenChange,
  accounts,
  onOpenThread,
  onCompose,
  onDrafts,
  onMailbox,
  onSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: MailAccountView[]
  onOpenThread: (thread: MailThreadView) => void
  onCompose: () => void
  onDrafts: () => void
  /** Empty for every mailbox. */
  onMailbox: (id: string) => void
  onSettings: () => void
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.spotlight
  const [query, setQuery] = useState("")
  const settled = useDebounced(query.trim())
  const searching = settled.length >= MIN_QUERY
  const previousFocus = useRef<HTMLElement | null>(null)
  const navigating = useRef(false)
  const accountOf = new Map(accounts.map((account) => [account.id, account]))

  const results = useQuery({
    queryKey: ["mail-search", settled],
    queryFn: () =>
      api<{ hits: MailSearchHit[]; failedAccounts: string[] }>(`/api/mail/search?q=${encodeURIComponent(settled)}`),
    enabled: open && searching,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })

  // A new search starts empty.
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement
      setQuery("")
    }
  }, [open])

  function choose(run: () => void) {
    navigating.current = true
    onOpenChange(false)
    run()
  }

  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  const commands: SpotlightCommand[] = [
    { id: "compose", label: t.newMessage, icon: PencilEdit02Icon, run: onCompose },
    { id: "all", label: t.allMailboxes, icon: InboxIcon, run: () => onMailbox("") },
    { id: "drafts", label: t.drafts, icon: File01Icon, run: onDrafts },
    ...accounts.map((account) => ({
      id: `mailbox-${account.id}`,
      label: account.email,
      account,
      run: () => onMailbox(account.id),
    })),
    { id: "settings", label: t.settings, icon: Settings01Icon, run: onSettings },
  ].filter((command) => words.every((word) => normalize(command.label).includes(word)))

  const hits = searching ? (results.data?.hits ?? []) : []
  const pending = searching && (results.isFetching || settled !== query.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="list-spotlight sm:max-w-2xl"
        style={{ translate: "-50% 0" }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const previous = previousFocus.current
          if (!navigating.current && previous?.isConnected && !previous.closest("[inert]")) previous.focus()
          navigating.current = false
        }}
      >
        <DialogTitle className="sr-only">{t.title}</DialogTitle>
        <DialogDescription className="sr-only">{t.description}</DialogDescription>
        <Command loop shouldFilter={false}>
          <CommandInput
            aria-label={t.search}
            placeholder={t.placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList aria-label={t.results} className="max-h-[min(460px,55dvh)]!">
            {!pending && commands.length === 0 && hits.length === 0 && (searching || words.length > 0) && (
              <CommandEmpty>{results.isError ? t.failed : t.empty}</CommandEmpty>
            )}
            {commands.length > 0 && (
              <CommandGroup heading={t.goTo}>
                {commands.map((command) => (
                  <CommandItem key={command.id} value={command.id} onSelect={() => choose(command.run)}>
                    {command.account ? (
                      <span className="flex size-4 items-center justify-center">
                        <AccountDot color={command.account.color} />
                      </span>
                    ) : (
                      command.icon && <HugeiconsIcon icon={command.icon} strokeWidth={2} aria-hidden="true" />
                    )}
                    <span className="spotlight-name truncate">{command.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {searching && (
              <CommandGroup
                heading={
                  <span className="flex items-center gap-2">
                    {t.mail}
                    {pending && <Spinner className="size-3" />}
                  </span>
                }
              >
                {hits.map((hit) => {
                  const mailbox = accounts.length > 1 ? accountOf.get(hit.accountId) : undefined
                  return (
                    <CommandItem
                      key={`${hit.accountId}:${hit.threadId}`}
                      value={`${hit.accountId}:${hit.threadId}`}
                      className="items-start py-2"
                      onSelect={() => choose(() => onOpenThread(searchHitAsThread(hit)))}
                    >
                      <HugeiconsIcon icon={Mail01Icon} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 text-muted-foreground" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className={cn("min-w-0 flex-1 truncate", !hit.isRead && "font-semibold")}>
                            {hit.fromName ?? hit.fromEmail ?? strings.inbox.unknownSender}
                          </span>
                          {hit.hasAttachments && (
                            <HugeiconsIcon
                              icon={Attachment01Icon}
                              strokeWidth={1.75}
                              aria-label={strings.inbox.attachment}
                              className="size-3.5 text-muted-foreground"
                            />
                          )}
                          <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={hit.receivedAt}>
                            {shortDate(hit.receivedAt, locale)}
                          </time>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            <span className="text-foreground">{hit.subject || strings.inbox.noSubject}</span>
                            {hit.snippet && ` · ${hit.snippet}`}
                          </span>
                          {mailbox && <AccountDot color={mailbox.color} label={mailbox.email} />}
                        </span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {searching && !!results.data?.failedAccounts.length && (
          <p className="px-3 pt-2 text-xs text-muted-foreground">{t.someFailed}</p>
        )}
        <p className="spotlight-help">
          {searching || words.length > 0 ? (
            <>
              <span>{t.choose}</span>
              <span>{t.open}</span>
              <span>{t.close}</span>
            </>
          ) : (
            <span>{t.hint}</span>
          )}
        </p>
      </DialogContent>
    </Dialog>
  )
}
