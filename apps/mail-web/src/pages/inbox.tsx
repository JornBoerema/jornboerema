import { useEffect, useRef } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import {
  ArchiveIcon,
  Attachment01Icon,
  Delete02Icon,
  CloudAlertIcon,
  InboxIcon,
  PencilEdit02Icon,
  StarIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
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
  MailDraftView,
  MailThreadAction,
  MailThreadsPage,
  MailThreadView,
} from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import {
  MailMenu,
  SidebarExpand,
  type MailNavigation,
} from "@/components/sidebar"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import type { DraftRef, useDrafts } from "@/lib/drafts"
import { useHotkeys } from "@/lib/hotkeys"
import { MESSAGES_KEY, useThreadAction, type SyncStatus } from "@/lib/mail"
import { ComposePage } from "@/pages/compose"
import { ConversationPage } from "@/pages/conversation"

function shortDate(iso: string, locale: string) {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    })
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  })
}

/**
 * Quick actions over the row's right end. They show on hover or keyboard focus,
 * in place of the date, and sit beside the row's button rather than inside it.
 */
function RowActions({ actions }: { actions: { icon: IconSvgElement; label: string; run: () => void }[] }) {
  return (
    <span className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:bg-background/70 hover:text-foreground"
          aria-label={action.label}
          title={action.label}
          onClick={action.run}
        >
          <HugeiconsIcon icon={action.icon} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      ))}
    </span>
  )
}

/** What the quick actions cover: the date and the small icons beside it. */
const UNDER_ACTIONS = "group-focus-within:invisible group-hover:invisible"

function ThreadRow({
  thread,
  mailbox,
  selected,
  onOpen,
  onAction,
}: {
  thread: MailThreadView
  /** Only set when several mailboxes share the list. */
  mailbox: MailAccountView | undefined
  selected: boolean
  onOpen: () => void
  onAction: (action: "archive" | "trash") => void
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.inbox
  const row = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  const unread = !thread.isRead
  const icon = cn("size-3.5 shrink-0 text-muted-foreground", UNDER_ACTIONS)
  const actions = strings.conversation

  return (
    <li className="group relative">
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
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              unread ? "font-semibold" : "text-muted-foreground"
            )}
          >
            {unread && <span className="sr-only">{t.unread}: </span>}
            {thread.fromName ?? thread.fromEmail ?? t.unknownSender}
            {thread.messageCount > 1 && (
              <span className="font-normal text-muted-foreground">
                {" "}
                {thread.messageCount}
              </span>
            )}
          </span>
          {thread.isStarred && (
            <HugeiconsIcon
              icon={StarIcon}
              strokeWidth={1.75}
              aria-label={t.starred}
              className={icon}
            />
          )}
          {thread.hasAttachments && (
            <HugeiconsIcon
              icon={Attachment01Icon}
              strokeWidth={1.75}
              aria-label={t.attachment}
              className={icon}
            />
          )}
          <time
            className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", UNDER_ACTIONS)}
            dateTime={thread.receivedAt}
          >
            {shortDate(thread.receivedAt, locale)}
          </time>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className={cn(unread && "font-medium text-foreground")}>
              {thread.subject || t.noSubject}
            </span>
            {thread.snippet && ` · ${thread.snippet}`}
          </span>
          {mailbox && (
            <AccountDot
              color={mailbox.color}
              label={mailbox.email}
              className="mr-0.5 self-center"
            />
          )}
        </span>
      </button>
      <RowActions
        actions={[
          { icon: ArchiveIcon, label: actions.archive, run: () => onAction("archive") },
          { icon: Delete02Icon, label: actions.trash, run: () => onAction("trash") },
        ]}
      />
    </li>
  )
}

function DraftRow({
  draft,
  mailbox,
  selected,
  onOpen,
  onDelete,
}: {
  draft: MailDraftView
  mailbox: MailAccountView | undefined
  selected: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const { t, locale } = useI18n()
  const recipients = draft.to
    .map((address) => address.name || address.email)
    .join(", ")
  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:bg-accent",
          selected ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !recipients && "text-muted-foreground"
            )}
          >
            {recipients || t.drafts.noRecipients}
          </span>
          {draft.hasAttachments && (
            <HugeiconsIcon
              icon={Attachment01Icon}
              strokeWidth={1.75}
              aria-label={t.inbox.attachment}
              className={cn("size-3.5 shrink-0 text-muted-foreground", UNDER_ACTIONS)}
            />
          )}
          <time
            className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", UNDER_ACTIONS)}
            dateTime={draft.updatedAt}
          >
            {shortDate(draft.updatedAt, locale)}
          </time>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="text-foreground">
              {draft.subject || t.inbox.noSubject}
            </span>
            {draft.snippet && ` · ${draft.snippet}`}
          </span>
          {mailbox && (
            <AccountDot
              color={mailbox.color}
              label={mailbox.email}
              className="mr-0.5 self-center"
            />
          )}
        </span>
      </button>
      <RowActions actions={[{ icon: Delete02Icon, label: t.compose.discard, run: onDelete }]} />
    </li>
  )
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="px-2 pb-2">
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
function LoadMore({
  onVisible,
  loading,
}: {
  onVisible: () => void
  loading: boolean
}) {
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
  open,
  onOpen,
  compose,
  composeHidden,
  composeDraftId,
  drafts,
  onOpenDraft,
  onDeleteDraft,
  discardRequest,
  onComposeDraftChange,
  onHideCompose,
  onCloseCompose,
}: {
  navigation: MailNavigation
  syncStatus: SyncStatus
  loadingAccounts: boolean
  open: MailThreadView | null
  onOpen: (thread: MailThreadView | null) => void
  compose: { key: number; draft: DraftRef | null } | null
  composeHidden: boolean
  composeDraftId: string | null
  drafts: ReturnType<typeof useDrafts>
  onOpenDraft: (draft: DraftRef) => void
  onDeleteDraft: (draft: DraftRef) => void
  /** Goes up when the open draft should be thrown away. */
  discardRequest: number
  onComposeDraftChange: (id: string | null) => void
  onHideCompose: () => void
  onCloseCompose: () => void
}) {
  const strings = useI18n().t
  const t = strings.inbox
  const showDrafts = navigation.view === "drafts"
  const draftRows = drafts.data?.drafts ?? []
  const { accounts, accountId, onCompose, onSettings } = navigation
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
  const accountOf = new Map(accounts.map((account) => [account.id, account]))

  useEffect(() => onOpen(null), [accountId, onOpen])
  const composing = compose !== null
  const composerVisible = composing && !composeHidden
  const showingDetail = Boolean(open) || composerVisible

  function step(by: number) {
    if (showDrafts) return
    const next = rows[Math.max(0, position + by)]
    if (next) onOpen(next)
  }

  function leave(thread: MailThreadView, action: MailThreadAction) {
    // Marking unread means "not now", so the next mail shouldn't open by itself.
    onOpen(
      action === "unread"
        ? null
        : (rows[position + 1] ?? rows[position - 1] ?? null)
    )
    runAction({ id: thread.id, action })
  }

  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    c: onCompose,
    Escape: () => onOpen(null),
  })

  return (
    <>
      <section
        className={cn(
          "min-h-0 w-full shrink-0 flex-col md:w-80 xl:w-96",
          showingDetail ? "hidden md:flex" : "flex"
        )}
      >
        <header
          className={cn(
            "flex h-14 shrink-0 items-center gap-1.5 pr-2 pl-2",
            !navigation.sidebar.collapsed && "lg:pl-4.5"
          )}
        >
          <MailMenu {...navigation} />
          <SidebarExpand sidebar={navigation.sidebar} />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {showDrafts
              ? strings.drafts.title
              : (selectedAccount?.email ?? t.title)}
          </h1>
          <span
            role="status"
            className="flex items-center text-muted-foreground"
          >
            {syncStatus === "syncing" && (
              <span title={t.syncing}>
                <Spinner />
                <span className="sr-only">{t.syncing}</span>
              </span>
            )}
            {syncStatus === "failed" && (
              <span title={t.syncFailed}>
                <HugeiconsIcon
                  icon={CloudAlertIcon}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="size-4"
                />
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
            <HugeiconsIcon
              icon={PencilEdit02Icon}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </Button>
        </header>

        {/* Relative keeps absolute children, like screen-reader text, inside this scroller. */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {showDrafts ? (
            <>
              {drafts.isPending && <ListSkeleton />}
              {drafts.isError && (
                <p className="p-4 text-sm text-destructive">
                  {strings.drafts.loadFailed}
                </p>
              )}
              {!!drafts.data?.failedAccounts.length && (
                <p className="px-4 pb-2 text-xs text-muted-foreground">
                  {strings.drafts.someFailed}
                </p>
              )}
              {drafts.isSuccess && draftRows.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {strings.drafts.empty}
                </p>
              )}
              <ul className="flex flex-col gap-0.5 px-2 pb-2">
                {draftRows.map((draft) => (
                  <DraftRow
                    key={`${draft.accountId}:${draft.id}`}
                    draft={draft}
                    mailbox={
                      accounts.length > 1
                        ? accountOf.get(draft.accountId)
                        : undefined
                    }
                    selected={composerVisible && draft.id === composeDraftId}
                    onOpen={() =>
                      onOpenDraft({ accountId: draft.accountId, id: draft.id })
                    }
                    onDelete={() =>
                      onDeleteDraft({ accountId: draft.accountId, id: draft.id })
                    }
                  />
                ))}
              </ul>
            </>
          ) : (
            <>
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
                  {messages.isError && (
                    <p className="p-4 text-sm text-destructive">
                      {t.loadFailed}
                    </p>
                  )}
                  {messages.isSuccess &&
                    !loadingAccounts &&
                    rows.length === 0 && (
                      <p className="p-4 text-sm text-muted-foreground">
                        {syncStatus === "syncing" ? t.firstSync : t.empty}
                      </p>
                    )}
                  <ul className="flex flex-col gap-0.5 px-2 pb-2">
                    {rows.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        mailbox={
                          !accountId && accounts.length > 1
                            ? accountOf.get(thread.accountId)
                            : undefined
                        }
                        selected={thread.id === open?.id}
                        onOpen={() => onOpen(thread)}
                        onAction={(action) =>
                          thread.id === open?.id
                            ? leave(thread, action)
                            : runAction({ id: thread.id, action })
                        }
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
            </>
          )}
        </div>
      </section>

      <section
        className={cn(
          "floating-panel min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:rounded-none! max-md:shadow-none! md:m-2 md:ml-0",
          showingDetail ? "flex" : "hidden md:flex"
        )}
      >
        {compose && (
          <ComposePage
            key={compose.key}
            accounts={accounts}
            defaultAccountId={accountId}
            draft={compose.draft}
            hidden={Boolean(open) || composeHidden}
            onHide={onHideCompose}
            onClose={onCloseCompose}
            onDraftChange={onComposeDraftChange}
            discardRequest={discardRequest}
          />
        )}
        {open ? (
          <ConversationPage
            key={open.id}
            thread={open}
            account={accountOf.get(open.accountId)}
            onBack={() => onOpen(null)}
            onLeave={(action) => leave(open, action)}
          />
        ) : (
          !composerVisible && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon
                icon={InboxIcon}
                strokeWidth={1.5}
                aria-hidden="true"
                className="size-5"
              />
              {t.nothingOpen}
            </div>
          )
        )}
      </section>
    </>
  )
}
