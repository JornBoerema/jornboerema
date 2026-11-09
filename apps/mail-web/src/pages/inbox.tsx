import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Button } from "@evido/ui/components/button"
import type {
  MailAccountView,
  MailThreadsPage,
  MailThreadView,
} from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { MESSAGES_KEY, type SyncStatus } from "@/lib/mail"
import { ComposePage } from "@/pages/compose"
import { ConversationPage } from "@/pages/conversation"

function ThreadRow({
  thread,
  accountEmail,
  onOpen,
}: {
  thread: MailThreadView
  accountEmail: string | undefined
  onOpen: () => void
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.inbox
  const received = new Date(thread.receivedAt).toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "short",
  })
  const weight = thread.isRead ? "" : "font-semibold"
  return (
    <li className="border-b text-sm">
      <button type="button" className="block w-full py-3 text-left" onClick={onOpen}>
        <div className="flex items-baseline justify-between gap-4">
          <p className={`truncate ${weight}`}>
            {!thread.isRead && <span className="sr-only">{t.unread}: </span>}
            {thread.fromName ?? thread.fromEmail ?? t.unknownSender}
            {thread.messageCount > 1 && (
              <span className="font-normal text-muted-foreground"> ({thread.messageCount})</span>
            )}
          </p>
          <time className="shrink-0 text-xs text-muted-foreground" dateTime={thread.receivedAt}>
            {received}
          </time>
        </div>
        <p className={`truncate ${weight}`}>
          {thread.isStarred && <span aria-label={t.starred}>★ </span>}
          {thread.hasAttachments && <span aria-label={t.attachment}>📎 </span>}
          {thread.subject || t.noSubject}
        </p>
        <p className="truncate text-muted-foreground">{thread.snippet}</p>
        <p className="truncate text-xs text-muted-foreground">{accountEmail}</p>
      </button>
    </li>
  )
}

export function InboxPage({
  accounts,
  syncStatus,
}: {
  accounts: MailAccountView[]
  syncStatus: SyncStatus
}) {
  const t = useI18n().t.inbox
  const [accountId, setAccountId] = useState("")
  const [open, setOpen] = useState<MailThreadView | null>(null)
  const [composing, setComposing] = useState(false)
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
  const emailOf = new Map(accounts.map((account) => [account.id, account.email]))

  if (open)
    return (
      <ConversationPage
        thread={open}
        accountEmail={emailOf.get(open.accountId) ?? ""}
        onBack={() => setOpen(null)}
      />
    )
  if (composing) return <ComposePage accounts={accounts} onClose={() => setComposing(false)} />
  if (accounts.length === 0) return <p className="text-sm text-muted-foreground">{t.noMailboxes}</p>

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-4 text-sm">
        <select
          aria-label={t.filter}
          className="rounded-md border bg-background px-2 py-1"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="">{t.allMailboxes}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => setComposing(true)}>
          {t.compose}
        </Button>
        <span className="ml-auto text-muted-foreground" role="status">
          {syncStatus === "syncing" && t.syncing}
          {syncStatus === "failed" && t.syncFailed}
        </span>
      </div>

      {messages.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      {messages.isSuccess && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {syncStatus === "syncing" ? t.firstSync : t.empty}
        </p>
      )}
      <ul>
        {rows.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            accountEmail={emailOf.get(thread.accountId)}
            onOpen={() => setOpen(thread)}
          />
        ))}
      </ul>
      {messages.hasNextPage && (
        <Button
          variant="outline"
          disabled={messages.isFetchingNextPage}
          onClick={() => void messages.fetchNextPage()}
        >
          {t.loadMore}
        </Button>
      )}
    </section>
  )
}
