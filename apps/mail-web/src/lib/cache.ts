import type { QueryClient } from "@tanstack/react-query"
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { persistQueryClient } from "@tanstack/react-query-persist-client"

/**
 * Where the desktop app keeps mail: a database on disk, through Rust, instead of
 * localStorage. Set before the app mounts; the web leaves it unset and keeps
 * using localStorage, with opened conversations in memory only.
 */
export type MailStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getThread(userId: string, id: string): Promise<string | null>
  putThread(userId: string, id: string, value: string): Promise<void>
  clear(): Promise<void>
}

let diskStorage: MailStorage | null = null
/** Whose conversations are read and written, set while their mail is open. */
let currentUser: string | null = null

export function setMailStorage(storage: MailStorage) {
  diskStorage = storage
}

/** The query that holds one opened conversation (see threadQuery). */
const THREAD_KEY = "mail-thread"

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
 * The desktop database, which starts out with what an earlier version kept in
 * localStorage: moved over once, so updating doesn't open with empty lists.
 */
function diskWithMove(disk: MailStorage) {
  return {
    getItem: async (key: string) => {
      const kept = await disk.getItem(key)
      if (kept !== null) return kept
      const local = storage()
      const old = local?.getItem(key) ?? null
      if (old !== null) {
        await disk.setItem(key, old)
        local?.removeItem(key)
      }
      return old
    },
    setItem: (key: string, value: string) => disk.setItem(key, value),
    removeItem: (key: string) => disk.removeItem(key),
  }
}

/**
 * The desktop app also keeps each conversation it opens, so opening it again
 * shows it at once while a fresh copy loads. Only what came from the API:
 * optimistic edits made by hand are not written.
 */
function keepOpenedThreads(queryClient: QueryClient, disk: MailStorage, userId: string) {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) return
    const [kind, id] = event.query.queryKey
    if (kind !== THREAD_KEY || typeof id !== "string") return
    try {
      void disk.putThread(userId, id, JSON.stringify(event.query.state.data)).catch(() => {})
    } catch {
      // Not serializable: it is fetched again next time.
    }
  })
}

/** A conversation the desktop app kept, or null (and always null on the web). */
export async function readStoredThread<T>(id: string): Promise<T | null> {
  if (!diskStorage || !currentUser) return null
  try {
    const kept = await diskStorage.getThread(currentUser, id)
    return kept ? (JSON.parse(kept) as T) : null
  } catch {
    return null
  }
}

export const keepsThreads = () => diskStorage !== null

/**
 * Keeps the mail lists in this browser, so a reload shows them at once and then
 * refreshes them. Returns when the stored lists are back in the client.
 */
export function persistMailCache(queryClient: QueryClient, userId: string) {
  currentUser = userId
  const key = `${PREFIX}${userId}`
  const disk = diskStorage
  const persister = disk
    ? createAsyncStoragePersister({ storage: diskWithMove(disk), key, throttleTime: 1000 })
    : createSyncStoragePersister({ storage: storage(), key, throttleTime: 1000 })
  const stopThreads = disk ? keepOpenedThreads(queryClient, disk, userId) : () => {}
  const [stopLists, restored] = persistQueryClient({
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
  const unsubscribe = () => {
    stopLists()
    stopThreads()
  }
  return { unsubscribe, restored }
}

/** On signing out: what was kept for any user in this browser (or on this computer) goes. */
export async function clearMailCache() {
  currentUser = null
  const store = storage()
  try {
    if (store) for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key)
  } catch {
    // Nothing kept, then.
  }
  await diskStorage?.clear().catch(() => {})
}

/** Who was let in on this device (see the access gate). */
export const ACCESS_KEY = "evido.mail.access"

/** What a signed-out browser shouldn't keep: the cached mail and who was let in. */
export function forgetSignedOutUser() {
  void clearMailCache()
  try {
    localStorage.removeItem(ACCESS_KEY)
  } catch {
    // Blocked storage has nothing to clear.
  }
}
