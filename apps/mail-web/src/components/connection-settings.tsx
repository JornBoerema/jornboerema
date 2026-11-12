import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@evido/ui/components/select"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import type { ConnectionErrorCode, ConnectionView } from "@evido/mail-core/connections"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { CONNECTIONS_KEY, useConnectMoneybird, useConnections } from "@/lib/connections"

const ASK = "ask"

/** Shows how connecting went once, then cleans the URL. */
function useConnectResult() {
  const t = useI18n().t.connections
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get("connection_error") as ConnectionErrorCode | null
    if (!code && params.get("connected") !== "moneybird") return
    if (code) toast.error(t.errors[code] ?? t.errors.failed)
    else toast.success(t.connected)
    window.history.replaceState(null, "", window.location.pathname)
  }, [t])
}

function AdministrationPicker({ connection }: { connection: ConnectionView }) {
  const t = useI18n().t.connections
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (administrationId: string | null) =>
      api("/api/connections/moneybird", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ administrationId }),
      }),
    onError: (error) => toast.error(errorText(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  })
  const [value, setValue] = useState(connection.defaultTarget?.id ?? ASK)
  useEffect(() => setValue(connection.defaultTarget?.id ?? ASK), [connection.defaultTarget?.id])
  return (
    <SettingsRow title={t.administration} htmlFor="moneybird-administration" description={t.administrationHelp}>
      <Select
        value={value}
        onValueChange={(next) => {
          setValue(next)
          change.mutate(next === ASK ? null : next)
        }}
      >
        <SelectTrigger id="moneybird-administration" className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            <SelectItem value={ASK}>{t.askEachTime}</SelectItem>
            {connection.administrations.map((administration) => (
              <SelectItem key={administration.id} value={administration.id}>
                {administration.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsRow>
  )
}

function Disconnect() {
  const t = useI18n().t.connections
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const disconnect = useMutation({
    mutationFn: () => api("/api/connections/moneybird", { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <>
      <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => setConfirming(true)}>
        {t.disconnect}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.disconnectTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.disconnectBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => disconnect.mutate()}>
              {t.disconnect}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Services linked once, so mail goes there in one click. Moneybird for now.
 * `title` names the part in the desktop app, where every app's connections share a page.
 */
export function ConnectionSettings({ title }: { title?: string }) {
  const t = useI18n().t.connections
  useConnectResult()
  const connections = useConnections()
  const connect = useConnectMoneybird()
  const moneybird = connections.data?.connections.find((item) => item.provider === "moneybird")
  const available = connections.data?.available.includes("moneybird") ?? false
  const active = moneybird?.status === "active"
  const description = !moneybird
    ? available
      ? t.moneybirdHelp
      : t.unavailable
    : !active
      ? t.reconnectNeeded
      : moneybird.defaultTarget
        ? t.connectedTo(moneybird.defaultTarget.name)
        : t.connectedAsk(moneybird.administrations.length)

  return (
    <>
      <SettingsSection title={title ?? t.title} description={t.description}>
        {connections.isError && <SettingsRow title={t.loadFailed} destructive />}
        {connections.isSuccess && (
          <SettingsRow title="Moneybird" description={description}>
            {(!moneybird || !active) && (
              <Button size="sm" variant={moneybird ? "default" : "outline"} disabled={!available || connect.isPending} onClick={() => connect.mutate()}>
                {moneybird ? t.reconnect : t.connect}
              </Button>
            )}
            {moneybird && <Disconnect />}
          </SettingsRow>
        )}
      </SettingsSection>
      {moneybird && active && moneybird.administrations.length > 1 && (
        <SettingsSection title={t.moneybirdTitle}>
          <AdministrationPicker connection={moneybird} />
        </SettingsSection>
      )}
    </>
  )
}
