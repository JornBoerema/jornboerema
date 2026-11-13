import { createRealtimeClient, QueryRefreshController, type SealedLiveQuery } from "@neon/realtime/client"

type PingRow = { version: string }
type Subscription = { url: string; query: SealedLiveQuery<PingRow> }

/** What the app shows: connected, (re)connecting, or no live updates. */
export type RealtimeStatus = "connected" | "connecting" | "disconnected"

/**
 * Watches one channel. `onChange` runs when something changed, and also each
 * time the connection comes (back) up, so nothing missed while offline stays stale.
 * `fetchSubscription` asks the API for a fresh sealed query (they last 60 s).
 * Returns a function that stops watching.
 */
export function watchChannel({ fetchSubscription, onChange, onStatus }: {
  fetchSubscription: () => Promise<Subscription>
  onChange: () => void
  onStatus?: (status: RealtimeStatus) => void
}) {
  let stopped = false
  let stop = () => {}
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  async function start() {
    onStatus?.("connecting")
    let first: Subscription
    try {
      first = await fetchSubscription()
    } catch {
      return again()
    }
    if (stopped) return
    const client = createRealtimeClient({ url: first.url })
    const subscription = client.subscribe(first.query)
    let lastVersion: string | undefined
    let wasLive = false
    const refresh = new QueryRefreshController<PingRow>({
      query: first.query,
      refreshQuery: async () => (await fetchSubscription()).query,
      renewSubscription: (query) => subscription.renew(query),
      onRefreshExhausted: () => { cleanup(); again() },
      subscription,
    })
    const off = subscription.onChange((snapshot) => {
      if (snapshot.status === "error" || snapshot.status === "closed") {
        onStatus?.("disconnected")
        cleanup()
        if (snapshot.status === "error") again()
        return
      }
      if (snapshot.status !== "live") {
        wasLive = false
        onStatus?.("connecting")
        return
      }
      attempt = 0
      onStatus?.("connected")
      const version = snapshot.data?.[0]?.version
      // Back online, or the counter moved: fetch what changed.
      if (!wasLive || version !== lastVersion) onChange()
      wasLive = true
      lastVersion = version
    })
    refresh.start()
    function cleanup() {
      refresh.stop()
      off()
      subscription.unsubscribe()
      client.close()
      stop = () => {}
    }
    stop = cleanup
  }

  // Fatal errors need a fresh client; back off up to a minute.
  function again() {
    if (stopped) return
    onStatus?.("disconnected")
    const delay = Math.min(60_000, 2_000 * 2 ** attempt++)
    retry = setTimeout(() => void start(), delay)
  }

  void start()
  return () => {
    stopped = true
    if (retry) clearTimeout(retry)
    stop()
  }
}
