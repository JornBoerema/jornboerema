import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Realtime } from "ably"
import type { MailAccountView, MailSyncResult } from "@evido/mail-core/types"
import { api, ApiError } from "@/lib/api"

export const ACCOUNTS_KEY = ["mail-accounts"]
export const MESSAGES_KEY = ["mail-messages"]

/** Only a safety net: new mail normally arrives through webhooks and a realtime signal. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000
const BUSY_RETRY_MS = 3 * 1000

export type SyncStatus = "idle" | "syncing" | "failed"

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => api<{ accounts: MailAccountView[] }>("/api/mail/accounts"),
  })
}

/** Refreshes the list the moment the server has synced something new. */
export function useMailRealtime(userId: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const realtime = new Realtime({
      authCallback: (_params, callback) => {
        api<Parameters<typeof callback>[1]>("/api/mail/realtime").then(
          (token) => callback(null, token),
          (error: unknown) => callback(error instanceof Error ? error.message : String(error), null)
        )
      },
      closeOnUnload: true,
    })
    const channel = realtime.channels.get(`mail:${userId}`)
    void channel.subscribe("changed", () => {
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
    })
    return () => realtime.close()
  }, [userId, queryClient])
}

/** Keeps every active mailbox in sync while the page is open and visible. */
export function useMailSync(accounts: MailAccountView[] | undefined) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SyncStatus>("idle")
  const key = useMemo(
    () =>
      (accounts ?? [])
        .filter((account) => account.status === "active")
        .map((account) => account.id)
        .join(","),
    [accounts]
  )

  useEffect(() => {
    if (!key) return
    const ids = key.split(",")
    let stopped = false
    let running = false

    async function syncOne(id: string) {
      while (!stopped) {
        const result = await api<MailSyncResult>(`/api/mail/accounts/${id}/sync`, { method: "POST" })
        if (result.changed > 0) void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
        if (result.done || result.rateLimited) return
        if (result.busy) await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS))
      }
    }

    async function run() {
      if (running || document.hidden) return
      running = true
      setStatus("syncing")
      const results = await Promise.allSettled(ids.map(syncOne))
      running = false
      if (stopped) return
      const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
      if (failures.some((error) => error instanceof ApiError && error.status === 409))
        void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      setStatus(failures.length > 0 ? "failed" : "idle")
    }

    void run()
    const timer = window.setInterval(() => void run(), SYNC_INTERVAL_MS)
    const onVisible = () => void run()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [key, queryClient])

  return status
}
