import { useEffect, useMemo, useRef, useState } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query"
import { Realtime } from "ably"
import { toast } from "sonner"
import {
  HIDDEN_FOLDERS,
  isMailFolder,
  type MailFolder,
  type MailAccountView,
  type MailSearchHit,
  type MailSyncResult,
  type MailThreadAction,
  type MailThreadDetail,
  type MailThreadsPage,
  type MailThreadView,
} from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { formatMoment, SCHEDULED_KEY, SNOOZES_KEY } from "@/lib/later"
import { api, ApiError, errorText } from "@/lib/api"
import { UndoneError, waitForUndo } from "@/lib/undo"
import { keepsThreads, readStoredThread } from "@/lib/cache"

export const ACCOUNTS_KEY = ["mail-accounts"]
export const MESSAGES_KEY = ["mail-messages"]
export const UNREAD_KEY = ["mail-unread"]
const ACTION_KEY = ["mail-thread-action"]

/** Only a safety net: new mail normally arrives through webhooks and a realtime signal. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000
/** After a failed round: try again this soon, before saying anything. */
const SYNC_RETRY_MS = 30 * 1000
const BUSY_RETRY_MS = 3 * 1000

export type SyncStatus = "idle" | "syncing" | "failed"

const REMOTE = "remote:"

/**
 * The API path of a conversation. Ones outside the synced inbox, found by search
 * or in a folder, have no row id, so they are addressed by mailbox and provider
 * thread id. Those from spam or trash also ask for the messages kept there.
 */
export function conversationUrl(id: string, suffix = "") {
  if (!id.startsWith(REMOTE)) return `/api/mail/threads/${encodeURIComponent(id)}${suffix}`
  const [accountId = "", scope, ...thread] = id.slice(REMOTE.length).split(":")
  const hidden = scope === "h" ? "&hidden=1" : ""
  return `/api/mail/accounts/${encodeURIComponent(accountId)}/conversation${suffix}?thread=${encodeURIComponent(thread.join(":"))}${hidden}`
}

/**
 * A conversation linked from elsewhere, such as a task in Even doen:
 * `?conversation=<mailbox>:<provider thread id>&subject=…`. Opened by its
 * provider id, so it works whatever folder it is in now.
 */
export function linkedThread(search: string): MailThreadView | null {
  const params = new URLSearchParams(search)
  const [accountId, ...thread] = (params.get("conversation") ?? "").split(":")
  if (!accountId || !thread.length) return null
  return {
    id: `${REMOTE}${accountId}:-:${thread.join(":")}`,
    accountId,
    subject: params.get("subject") ?? "",
    snippet: "",
    fromName: null,
    fromEmail: null,
    receivedAt: new Date().toISOString(),
    isRead: true,
    isStarred: false,
    hasAttachments: false,
    messageCount: 1,
  }
}

/** A search or folder hit as a list line, so the reading pane can open it like any other. */
export function searchHitAsThread(hit: MailSearchHit, folder?: MailFolder): MailThreadView {
  const hidden = folder !== undefined && HIDDEN_FOLDERS.includes(folder)
  return {
    // Hidden mail isn't in the synced inbox, so it never opens as an inbox row.
    id: (!hidden && hit.messageId) || `${REMOTE}${hit.accountId}:${hidden ? "h" : "-"}:${hit.threadId}`,
    accountId: hit.accountId,
    subject: hit.subject,
    snippet: hit.snippet,
    fromName: hit.fromName,
    fromEmail: hit.fromEmail,
    receivedAt: hit.receivedAt,
    isRead: hit.isRead,
    isStarred: hit.isStarred ?? false,
    hasAttachments: hit.hasAttachments,
    messageCount: 1,
    ...(folder === "sent" && hit.to && { to: hit.to }),
  }
}

/** Lists are keyed by mailbox ("" for all) and folder ("inbox" for the inbox). */
export const listKey = (accountId: string, folder: MailFolder | null) => [...MESSAGES_KEY, accountId, folder ?? "inbox"]

/** What leaves a folder's list when it happens; the rest only changes the line. */
const LEAVES: Record<MailFolder, MailThreadAction[]> = {
  starred: ["unstar", "trash", "spam"],
  sent: ["trash"],
  archive: ["trash", "inbox", "spam"],
  spam: ["trash", "inbox", "delete"],
  trash: ["inbox", "delete"],
}

/** A star that is set: filled, in the colour mail apps use for it. */
export const STARRED = "text-amber-500! [&_path]:fill-current"

/** Whether an action takes a conversation out of the list it is shown in. */
export const leavesList = (folder: MailFolder | null, action: MailThreadAction) =>
  folder ? LEAVES[folder].includes(action) : action === "archive" || action === "trash" || action === "spam"

/**
 * The actions that move a conversation on, as offered in each list. Deleting
 * for good only where the mailbox allows it (Outlook); reporting spam lives in
 * the toolbar and on !, not on every row.
 */
export function moveActions(folder: MailFolder | null, canDelete = false): MailThreadAction[] {
  if (folder === "trash") return canDelete ? ["inbox", "delete"] : ["inbox"]
  if (folder === "spam") return canDelete ? ["inbox", "trash", "delete"] : ["inbox", "trash"]
  if (folder === "archive") return ["inbox", "trash"]
  if (folder === "sent") return ["trash"]
  return ["archive", "trash"]
}

/** Where reporting spam makes sense: not for mail already in spam or trash, or sent by the user. */
export const canReportSpam = (folder: MailFolder | null) => folder !== "spam" && folder !== "trash" && folder !== "sent"

function changeLine(thread: MailThreadView, action: MailThreadAction): MailThreadView {
  if (action === "read" || action === "unread") return { ...thread, isRead: action === "read" }
  if (action === "star" || action === "unstar") return { ...thread, isStarred: action === "star" }
  return thread
}

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => api<{ accounts: MailAccountView[] }>("/api/mail/accounts"),
  })
}

function applyAction(threads: MailThreadView[], folder: MailFolder | null, id: string, action: MailThreadAction) {
  if (leavesList(folder, action)) return threads.filter((thread) => thread.id !== id)
  return threads.map((thread) => (thread.id === id ? changeLine(thread, action) : thread))
}

/** One conversation, or several at once from a selection. */
/** `until` snoozes: the conversation leaves the list as if archived and comes back then. */
type ActionInput = { action: MailThreadAction; until?: string } & (
  | { id: string; ids?: never }
  | { ids: string[]; id?: never }
)
const idsOf = (input: ActionInput) => input.ids ?? [input.id]
const ACTION_CONCURRENCY = 3

export function useThreadAction() {
  const queryClient = useQueryClient()
  const { t: strings, locale } = useI18n()
  const t = strings.conversation
  // Moves wait a moment so they can be taken back; marks and stars go at once.
  const done: Partial<Record<MailThreadAction, (count: number) => string>> = {
    archive: t.archived,
    trash: t.trashed,
    inbox: t.movedToInbox,
    spam: t.reportedSpam,
    delete: t.deletedForever,
  }
  return useMutation({
    mutationKey: ACTION_KEY,
    mutationFn: async (input: ActionInput) => {
      const ids = idsOf(input)
      const { until } = input
      const message = until
        ? (count: number) => strings.later.snoozed(count, formatMoment(new Date(until), locale))
        : done[input.action]
      // One undo for the whole selection, not one per conversation.
      const { leaving } = message ? await waitForUndo(message(ids.length), t.undo) : { leaving: false }
      const post = (id: string) =>
        api(conversationUrl(id, until ? "/snooze" : "/actions"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(until ? { until } : { action: input.action }),
          // Lets the request finish while the tab closes.
          keepalive: leaving,
        })
      for (let start = 0; start < ids.length; start += ACTION_CONCURRENCY)
        await Promise.all(ids.slice(start, start + ACTION_CONCURRENCY).map(post))
    },
    onMutate: async (input) => {
      const { action } = input
      const ids = idsOf(input)
      await queryClient.cancelQueries({ queryKey: MESSAGES_KEY })
      // Each list knows its folder, which decides whether the conversation leaves it.
      for (const [key, data] of queryClient.getQueriesData<InfiniteData<MailThreadsPage>>({ queryKey: MESSAGES_KEY })) {
        if (!data?.pages) continue
        const name = key[2]
        const folder = typeof name === "string" && isMailFolder(name) ? name : null
        queryClient.setQueryData<InfiniteData<MailThreadsPage>>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: ids.reduce((threads, id) => applyAction(threads, folder, id, action), page.threads),
          })),
        })
      }
    },
    // Undone: the list comes back from the server below, as nothing changed there.
    onError: (error) => {
      if (!(error instanceof UndoneError)) toast.error(errorText(error))
    },
    onSettled: () => {
      // A refetch while another action runs would briefly bring its thread back.
      if (queryClient.isMutating({ mutationKey: ACTION_KEY }) === 1) {
        void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
        void queryClient.invalidateQueries({ queryKey: UNREAD_KEY })
        void queryClient.invalidateQueries({ queryKey: SNOOZES_KEY })
      }
    },
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
      // A refetch now would bring back a conversation whose move is still waiting.
      if (queryClient.isMutating({ mutationKey: ACTION_KEY }) === 0)
        void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
      void queryClient.invalidateQueries({ queryKey: UNREAD_KEY })
      // A snooze that woke, or a scheduled message that went, changes these too.
      void queryClient.invalidateQueries({ queryKey: SNOOZES_KEY })
      void queryClient.invalidateQueries({ queryKey: SCHEDULED_KEY })
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
    // Rounds failed in a row. One failure is often a passing hiccup (a Mac waking
    // up, a provider fault), so only a second one in a row shows the warning.
    let failedRounds = 0
    let retry: number | undefined

    async function syncOne(id: string) {
      while (!stopped) {
        const result = await api<MailSyncResult>(`/api/mail/accounts/${id}/sync`, { method: "POST" })
        if (result.changed > 0) void queryClient.invalidateQueries({ queryKey: UNREAD_KEY })
        if (result.changed > 0 && queryClient.isMutating({ mutationKey: ACTION_KEY }) === 0)
          void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
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
      failedRounds = failures.length > 0 ? failedRounds + 1 : 0
      setStatus(failedRounds >= 2 ? "failed" : "idle")
      window.clearTimeout(retry)
      // A lasting fault (a mailbox to reconnect) waits for the normal rounds again.
      if (failedRounds > 0 && failedRounds < 3) retry = window.setTimeout(() => void run(), SYNC_RETRY_MS)
    }

    void run()
    const timer = window.setInterval(() => void run(), SYNC_INTERVAL_MS)
    const onVisible = () => void run()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.clearTimeout(retry)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [key, queryClient])

  return status
}

export type UnreadSummary = { count: number; latest: MailThreadView[] }

/** Unread inbox conversations: the count for the tab title, the newest for notifications. */
export function useUnread(enabled: boolean) {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => api<UnreadSummary>("/api/mail/unread"),
    enabled,
    // Webhooks and the realtime signal refresh it sooner; this only catches up.
    refetchInterval: 2 * 60 * 1000,
  })
}

/** Gmail and Graph take a moment to list a message they just sent or delivered. */
const AFTER_SEND_MS = 2500

/**
 * Syncs these mailboxes now instead of waiting for the provider's notification:
 * the sender, so the message is in Sent, and any own mailbox it went to.
 */
export function syncSoon(queryClient: QueryClient, accountIds: string[]) {
  window.setTimeout(() => {
    void Promise.allSettled(
      [...new Set(accountIds)].map((id) => api<MailSyncResult>(`/api/mail/accounts/${id}/sync`, { method: "POST" }))
    ).then(() => {
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
      void queryClient.invalidateQueries({ queryKey: UNREAD_KEY })
    })
  }, AFTER_SEND_MS)
}

/** Opened and prefetched conversations stay this long in memory, never on disk. */
const THREAD_MEMORY_MS = 5 * 60 * 1000
/** Hovering this long counts as aiming at a row, not passing over it. */
const HOVER_INTENT_MS = 60

export const threadQuery = (id: string) => ({
  queryKey: ["mail-thread", id],
  queryFn: () => api<MailThreadDetail>(conversationUrl(id)),
  staleTime: 60 * 1000,
  gcTime: THREAD_MEMORY_MS,
})

/**
 * In the desktop app: a conversation kept from an earlier visit shows at once,
 * marked old so the fresh copy that is loading replaces it. Offline, the kept
 * copy stays.
 */
export function useStoredThread(id: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!keepsThreads()) return
    const { queryKey } = threadQuery(id)
    if (queryClient.getQueryData(queryKey)) return
    let current = true
    void readStoredThread<MailThreadDetail>(id).then((kept) => {
      if (current && kept && !queryClient.getQueryData(queryKey))
        queryClient.setQueryData(queryKey, kept, { updatedAt: 0 })
    })
    return () => {
      current = false
    }
  }, [id, queryClient])
}

/**
 * Loads conversations before they're opened, so opening one is instant: the row
 * under the pointer, and the neighbours of the open one for J, K and archive.
 */
export function usePrefetchThreads() {
  const queryClient = useQueryClient()
  const timer = useRef<number | undefined>(undefined)
  return useMemo(
    () => ({
      now: (id: string) => void queryClient.prefetchQuery(threadQuery(id)),
      onHover: (id: string | null) => {
        window.clearTimeout(timer.current)
        if (id) timer.current = window.setTimeout(() => void queryClient.prefetchQuery(threadQuery(id)), HOVER_INTENT_MS)
      },
    }),
    [queryClient]
  )
}
