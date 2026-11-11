import type { QueryClient } from "@tanstack/react-query"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { persistQueryClient } from "@tanstack/react-query-persist-client"

/** One entry per user, so a shared browser never shows someone else's lists. */
const PREFIX = "evido.mail.cache."
/** Lists and counts only. Signatures can hold large inline images and are left out. */
const KEPT = new Set([
  "mail-messages",
  "mail-accounts",
  "mail-unread",
  "mail-drafts",
  "mail-shipments",
  "mail-invoices",
  "mail-senders",
  "mail-snoozes",
  "mail-scheduled",
])
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Raised when cached data changes shape, which drops older caches. */
const BUSTER = "1"

function storage() {
  try {
    return window.localStorage
  } catch {
    // Blocked storage: nothing is kept and the app loads lists as before.
    return undefined
  }
}

/**
 * Keeps the mail lists in this browser, so a reload shows them at once and then
 * refreshes them. Returns when the stored lists are back in the client.
 */
export function persistMailCache(queryClient: QueryClient, userId: string) {
  const persister = createSyncStoragePersister({ storage: storage(), key: `${PREFIX}${userId}`, throttleTime: 1000 })
  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: MAX_AGE_MS,
    buster: BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => query.state.status === "success" &&
        KEPT.has(String(query.queryKey[0])) &&
        // Background reading is a step, not a list: it runs again after a reload.
        query.queryKey[1] !== "scan",
    },
  })
  return { unsubscribe, restored }
}

/** On signing out: what was kept for any user in this browser goes. */
export function clearMailCache() {
  const store = storage()
  if (!store) return
  try {
    for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key)
  } catch {
    // Nothing kept, then.
  }
}
