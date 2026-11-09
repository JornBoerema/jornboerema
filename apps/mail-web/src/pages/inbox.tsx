import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Button } from "@evido/ui/components/button"
import type {
  MailAccountView,
  MailMessagesPage,
  MailMessageView,
} from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { MESSAGES_KEY, type SyncStatus } from "@/lib/mail"

function MessageRow({
  message,
  accountEmail,
}: {
  message: MailMessageView
  accountEmail: string | undefined
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.inbox
  const received = new Date(message.receivedAt).toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "short",
  })
  return (
    <li className="border-b py-3 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <p className={`truncate ${message.isRead ? "" : "font-semibold"}`}>
          {!message.isRead && <span className="sr-only">{t.unread}: </span>}
          {message.fromName ?? message.fromEmail ?? t.unknownSender}
        </p>
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={message.receivedAt}>
          {received}
        </time>
      </div>
      <p className={`truncate ${message.isRead ? "" : "font-semibold"}`}>
        {message.isStarred && <span aria-label={t.starred}>★ </span>}
        {message.hasAttachments && <span aria-label={t.attachment}>📎 </span>}
        {message.subject || t.noSubject}
      </p>
      <p className="truncate text-muted-foreground">{message.snippet}</p>
      <p className="truncate text-xs text-muted-foreground">{accountEmail}</p>
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
  const messages = useInfiniteQuery({
    queryKey: [...MESSAGES_KEY, accountId],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (accountId) params.set("account", accountId)
      if (pageParam) params.set("cursor", pageParam)
      return api<MailMessagesPage>(`/api/mail/messages?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
  })
  const rows = messages.data?.pages.flatMap((page) => page.messages) ?? []
  const emailOf = new Map(accounts.map((account) => [account.id, account.email]))

  if (accounts.length === 0) return <p className="text-sm text-muted-foreground">{t.noMailboxes}</p>

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 text-sm">
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
        <span className="text-muted-foreground" role="status">
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
        {rows.map((message) => (
          <MessageRow key={message.id} message={message} accountEmail={emailOf.get(message.accountId)} />
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
