import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog"
import { Button } from "@evido/ui/components/button"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import type {
  ConnectErrorCode,
  InboxSummary,
  MailAccountView,
  MailProviderId,
} from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api, ApiError, errorText } from "@/lib/api"
import { ACCOUNTS_KEY, MESSAGES_KEY, useAccounts } from "@/lib/mail"

const PROVIDER_NAMES: Record<MailProviderId, string> = { gmail: "Gmail", outlook: "Outlook" }

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
    onError: (error) => toast.error(errorText(error)),
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
  const [confirming, setConfirming] = useState(false)
  const disconnect = useMutation({
    mutationFn: () => api(`/api/mail/accounts/${account.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const active = account.status === "active"

  return (
    <SettingsRow
      title={account.email}
      description={
        <>
          {PROVIDER_NAMES[account.provider]} · {active ? <InboxLine id={account.id} /> : t.reconnectNeeded}
        </>
      }
    >
      {!active && (
        <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate(account.provider)}>
          {t.reconnect}
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => setConfirming(true)}>
        {t.disconnect}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmTitle(account.email)}</AlertDialogTitle>
            <AlertDialogDescription>{t.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => disconnect.mutate()}>
              {t.disconnect}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsRow>
  )
}

export function AccountsPage() {
  const t = useI18n().t.accounts
  useConnectResult()
  const connect = useConnect()
  const accounts = useAccounts()
  const list = accounts.data?.accounts ?? []

  return (
    <>
      <SettingsSection title={t.title}>
        {accounts.isError && <SettingsRow title={t.loadFailed} destructive />}
        {accounts.isSuccess && list.length === 0 && <SettingsRow title={t.empty} />}
        {list.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </SettingsSection>
      <SettingsSection title={t.connectTitle} description={t.connectHelp}>
        {(["gmail", "outlook"] as const).map((provider) => (
          <SettingsRow key={provider} title={PROVIDER_NAMES[provider]}>
            <Button size="sm" variant="outline" disabled={connect.isPending} onClick={() => connect.mutate(provider)}>
              {t.connect}
            </Button>
          </SettingsRow>
        ))}
      </SettingsSection>
    </>
  )
}
