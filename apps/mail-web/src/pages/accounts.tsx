import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import type {
  ConnectErrorCode,
  InboxSummary,
  MailAccountView,
  MailProviderId,
} from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api, ApiError } from "@/lib/api"
import { ACCOUNTS_KEY, MESSAGES_KEY, useAccounts } from "@/lib/mail"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Shows the outcome of the OAuth redirect once, then cleans the URL. */
function useConnectResult() {
  const { t } = useI18n()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get("error")
    if (!code && !params.has("connected")) return
    if (params.has("connected")) toast.success(t.accounts.connected)
    else toast.error(t.connectErrors[code as ConnectErrorCode] ?? t.connectErrors.failed)
    window.history.replaceState(null, "", window.location.pathname)
  }, [t])
}

function useConnect() {
  return useMutation({
    mutationFn: (provider: MailProviderId) =>
      api<{ url: string }>(`/api/mail/connect/${provider}`, { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(errorMessage(error)),
  })
}

function InboxLine({ id }: { id: string }) {
  const t = useI18n().t.accounts
  const queryClient = useQueryClient()
  const inbox = useQuery({
    queryKey: ["mail-inbox", id],
    queryFn: () => api<InboxSummary>(`/api/mail/accounts/${id}/inbox`),
    retry: false,
  })
  const lostAccess = inbox.error instanceof ApiError && inbox.error.status === 409
  useEffect(() => {
    if (lostAccess) void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
  }, [lostAccess, queryClient])

  if (inbox.isPending) return <>{t.inboxLoading}</>
  if (inbox.isError) return <>{t.inboxFailed}</>
  return <>{t.inbox(inbox.data.total, inbox.data.unread)}</>
}

function AccountRow({ account }: { account: MailAccountView }) {
  const t = useI18n().t.accounts
  const queryClient = useQueryClient()
  const connect = useConnect()
  const disconnect = useMutation({
    mutationFn: () => api(`/api/mail/accounts/${account.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const active = account.status === "active"

  return (
    <li className="flex items-center justify-between gap-4 border-b py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {account.email} <span className="text-muted-foreground">({account.provider})</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {active ? <InboxLine id={account.id} /> : t.reconnectNeeded}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {!active && (
          <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate(account.provider)}>
            {t.reconnect}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={disconnect.isPending}
          onClick={() => {
            if (window.confirm(t.confirmDisconnect(account.email))) disconnect.mutate()
          }}
        >
          {t.disconnect}
        </Button>
      </div>
    </li>
  )
}

export function AccountsPage() {
  const t = useI18n().t.accounts
  useConnectResult()
  const connect = useConnect()
  const accounts = useAccounts()

  return (
    <section className="flex flex-col gap-6">
      <div className="flex gap-2">
        <Button disabled={connect.isPending} onClick={() => connect.mutate("gmail")}>
          {t.addGmail}
        </Button>
        <Button disabled={connect.isPending} onClick={() => connect.mutate("outlook")}>
          {t.addOutlook}
        </Button>
      </div>

      {accounts.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      {accounts.data?.accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      )}
      <ul>
        {accounts.data?.accounts.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </ul>
    </section>
  )
}
