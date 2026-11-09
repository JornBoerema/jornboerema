import { useEffect, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import {
  Attachment01Icon,
  CloudAlertIcon,
  InboxIcon,
  PencilEdit02Icon,
  StarIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@evido/ui/components/empty"
import { Skeleton } from "@evido/ui/components/skeleton"
import { Spinner } from "@evido/ui/components/spinner"
import { cn } from "@evido/ui/lib/utils"
import type {
  MailAccountView,
  MailThreadAction,
  MailThreadsPage,
  MailThreadView,
} from "@evido/mail-core/types"
import { MailMenu, SidebarExpand, type MailNavigation } from "@/components/sidebar"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { useHotkeys } from "@/lib/hotkeys"
import { MESSAGES_KEY, useThreadAction, type SyncStatus } from "@/lib/mail"
import { ConversationPage } from "@/pages/conversation"

function shortDate(iso: string, locale: string) {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  })
}

/** The shortest name that tells mailboxes apart: their domain, or else their user part. */
function mailboxLabels(accounts: MailAccountView[]) {
  const domains = accounts.map((account) => account.email.split("@")[1]?.split(".")[0] ?? account.email)
  const distinct = new Set(domains).size === domains.length
  return new Map(
    accounts.map((account, index) => [
      account.id,
      distinct ? domains[index] : account.email.split("@")[0],
    ])
  )
}

function ThreadRow({
  thread,
  mailbox,
  selected,
  onOpen,
}: {
  thread: MailThreadView
  /** Only set when several mailboxes share the list. */
  mailbox: string | undefined
  selected: boolean
  onOpen: () => void
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.inbox
  const row = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  const unread = !thread.isRead
  const icon = "size-3.5 shrink-0 text-muted-foreground"

  return (
    <li>
      <button
        ref={row}
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:bg-accent",
          selected ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate", unread ? "font-semibold" : "text-muted-foreground")}>
            {unread && <span className="sr-only">{t.unread}: </span>}
            {thread.fromName ?? thread.fromEmail ?? t.unknownSender}
            {thread.messageCount > 1 && (
              <span className="font-normal text-muted-foreground"> {thread.messageCount}</span>
            )}
          </span>
          {thread.isStarred && (
            <HugeiconsIcon icon={StarIcon} strokeWidth={1.75} aria-label={t.starred} className={icon} />
          )}
          {thread.hasAttachments && (
            <HugeiconsIcon icon={Attachment01Icon} strokeWidth={1.75} aria-label={t.attachment} className={icon} />
          )}
          <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={thread.receivedAt}>
            {shortDate(thread.receivedAt, locale)}
          </time>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className={cn(unread && "font-medium text-foreground")}>{thread.subject || t.noSubject}</span>
            {thread.snippet && ` · ${thread.snippet}`}
          </span>
          {mailbox && <span className="max-w-20 shrink-0 truncate text-xs text-muted-foreground">{mailbox}</span>}
        </span>
      </button>
    </li>
  )
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="p-2">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 px-2.5 py-3">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  )
}

/** Loads the next page when the end of the list scrolls into view. */
function LoadMore({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const marker = useRef<HTMLDivElement>(null)
  const latest = useRef(onVisible)
  useEffect(() => {
    latest.current = onVisible
  })
  useEffect(() => {
    if (!marker.current || loading) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) latest.current()
    })
    observer.observe(marker.current)
    return () => observer.disconnect()
  }, [loading])
  return (
    <div ref={marker} className="flex h-12 items-center justify-center">
      {loading && <Spinner className="text-muted-foreground" />}
    </div>
  )
}

export function InboxPage({
  navigation,
  syncStatus,
  loadingAccounts,
}: {
  navigation: MailNavigation
  syncStatus: SyncStatus
  loadingAccounts: boolean
}) {
  const t = useI18n().t.inbox
  const { accounts, accountId, onCompose, onSettings } = navigation
  const [open, setOpen] = useState<MailThreadView | null>(null)
  const { mutate: runAction } = useThreadAction()
  const messages = useInfiniteQuery({
    queryKey: [...MESSAGES_KEY, accountId],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (accountId) params.set("account", accountId)
      if (pageParam) params.set("cursor", pageParam)
      return api<MailThreadsPage>(`/api/mail/threads?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
  })
  const rows = messages.data?.pages.flatMap((page) => page.threads) ?? []
  const position = open ? rows.findIndex((thread) => thread.id === open.id) : -1
  const selectedAccount = accounts.find((account) => account.id === accountId)
  const emailOf = new Map(accounts.map((account) => [account.id, account.email]))
  const labels = mailboxLabels(accounts)

  useEffect(() => setOpen(null), [accountId])

  function step(by: number) {
    const next = rows[Math.max(0, position + by)]
    if (next) setOpen(next)
  }

  function leave(thread: MailThreadView, action: MailThreadAction) {
    // Marking unread means "not now", so the next mail shouldn't open by itself.
    setOpen(action === "unread" ? null : (rows[position + 1] ?? rows[position - 1] ?? null))
    runAction({ id: thread.id, action })
  }

  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    c: onCompose,
    Escape: () => setOpen(null),
  })

  return (
    <>
      <section
        className={cn(
          "min-h-0 w-full shrink-0 flex-col border-r md:w-80 xl:w-96",
          open ? "hidden md:flex" : "flex"
        )}
      >
        <header
          className={cn(
            "flex h-12 shrink-0 items-center gap-1.5 border-b pr-2 pl-2",
            !navigation.sidebar.collapsed && "lg:pl-4"
          )}
        >
          <MailMenu {...navigation} />
          <SidebarExpand sidebar={navigation.sidebar} />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{selectedAccount?.email ?? t.title}</h1>
          <span role="status" className="flex items-center text-muted-foreground">
            {syncStatus === "syncing" && (
              <span title={t.syncing}>
                <Spinner />
                <span className="sr-only">{t.syncing}</span>
              </span>
            )}
            {syncStatus === "failed" && (
              <span title={t.syncFailed}>
                <HugeiconsIcon icon={CloudAlertIcon} strokeWidth={1.75} aria-hidden="true" className="size-4" />
                <span className="sr-only">{t.syncFailed}</span>
              </span>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={t.compose}
            onClick={onCompose}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {(messages.isPending || loadingAccounts) && <ListSkeleton />}
          {!loadingAccounts && accounts.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>{t.noMailboxes}</EmptyTitle>
                <EmptyDescription>{t.noMailboxesBody}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onSettings}>{t.connect}</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              {messages.isError && <p className="p-4 text-sm text-destructive">{t.loadFailed}</p>}
              {messages.isSuccess && !loadingAccounts && rows.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {syncStatus === "syncing" ? t.firstSync : t.empty}
                </p>
              )}
              <ul className="flex flex-col gap-0.5 p-2">
                {rows.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    mailbox={!accountId && accounts.length > 1 ? labels.get(thread.accountId) : undefined}
                    selected={thread.id === open?.id}
                    onOpen={() => setOpen(thread)}
                  />
                ))}
              </ul>
              {messages.hasNextPage && (
                <LoadMore
                  loading={messages.isFetchingNextPage}
                  onVisible={() => void messages.fetchNextPage()}
                />
              )}
            </>
          )}
        </div>
      </section>

      <section className={cn("min-h-0 min-w-0 flex-1 flex-col", open ? "flex" : "hidden md:flex")}>
        {open ? (
          <ConversationPage
            key={open.id}
            thread={open}
            accountEmail={emailOf.get(open.accountId) ?? ""}
            onBack={() => setOpen(null)}
            onLeave={(action) => leave(open, action)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <HugeiconsIcon icon={InboxIcon} strokeWidth={1.5} aria-hidden="true" className="size-5" />
            {t.nothingOpen}
          </div>
        )}
      </section>
    </>
  )
}
