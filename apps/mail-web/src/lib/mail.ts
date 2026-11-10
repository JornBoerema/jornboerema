import { useEffect, useMemo, useState } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"
import { Realtime } from "ably"
import { toast } from "sonner"
import {
  HIDDEN_FOLDERS,
  MAIL_FOLDERS,
  type MailFolder,
  type MailFolderPage,
  type MailAccountView,
  type MailSearchHit,
  type MailSyncResult,
  type MailThreadAction,
  type MailThreadsPage,
  type MailThreadView,
} from "@evido/mail-core/types"
import { api, ApiError, errorText } from "@/lib/api"

export const ACCOUNTS_KEY = ["mail-accounts"]
export const MESSAGES_KEY = ["mail-messages"]
const ACTION_KEY = ["mail-thread-action"]

/** Only a safety net: new mail normally arrives through webhooks and a realtime signal. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000
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

const FOLDERS_KEY = ["mail-folder"]
export const folderKey = (folder: MailFolder) => [...FOLDERS_KEY, folder]

/** What leaves a folder's list when it happens; the rest only changes the line. */
const LEAVES: Record<MailFolder, MailThreadAction[]> = {
  starred: ["unstar"],
  sent: ["trash"],
  archive: ["trash", "inbox"],
  spam: ["trash", "inbox"],
  trash: ["inbox"],
}

/** A star that is set: filled, in the colour mail apps use for it. */
export const STARRED = "text-amber-500! [&_path]:fill-current"

/** Whether an action takes a conversation out of the list it is shown in. */
export const leavesList = (folder: MailFolder | null, action: MailThreadAction) =>
  folder ? LEAVES[folder].includes(action) : action === "archive" || action === "trash"

/** The actions that move a conversation on, as offered in each list. */
export function moveActions(folder: MailFolder | null): MailThreadAction[] {
  if (folder === "trash") return ["inbox"]
  if (folder === "archive" || folder === "spam") return ["inbox", "trash"]
  if (folder === "sent") return ["trash"]
  return ["archive", "trash"]
}

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

function applyAction(threads: MailThreadView[], id: string, action: MailThreadAction) {
  if (action === "archive" || action === "trash") return threads.filter((thread) => thread.id !== id)
  return threads.map((thread) => (thread.id === id ? changeLine(thread, action) : thread))
}

/** Folder pages hold hits; a hit matches by the id its line opens with. */
function applyToFolder(page: MailFolderPage, folder: MailFolder, id: string, action: MailThreadAction) {
  const matches = (hit: MailSearchHit) => searchHitAsThread(hit, folder).id === id
  if (LEAVES[folder].includes(action)) return { ...page, hits: page.hits.filter((hit) => !matches(hit)) }
  return {
    ...page,
    hits: page.hits.map((hit) =>
      matches(hit)
        ? {
            ...hit,
            ...(action === "read" || action === "unread" ? { isRead: action === "read" } : {}),
            ...(action === "star" || action === "unstar" ? { isStarred: action === "star" } : {}),
          }
        : hit
    ),
  }
}

/** Updates the list at once; a refusal from the provider puts the real state back. */
export function useThreadAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ACTION_KEY,
    mutationFn: ({ id, action }: { id: string; action: MailThreadAction }) =>
      api(conversationUrl(id, "/actions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    onMutate: async ({ id, action }) => {
      await queryClient.cancelQueries({ queryKey: MESSAGES_KEY })
      await queryClient.cancelQueries({ queryKey: FOLDERS_KEY })
      for (const folder of MAIL_FOLDERS)
        queryClient.setQueryData<InfiniteData<MailFolderPage>>(
          folderKey(folder),
          (data) => data && { ...data, pages: data.pages.map((page) => applyToFolder(page, folder, id, action)) }
        )
      queryClient.setQueriesData<InfiniteData<MailThreadsPage>>(
        { queryKey: MESSAGES_KEY },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              threads: applyAction(page.threads, id, action),
            })),
          }
      )
    },
    onError: (error) => toast.error(errorText(error)),
    onSettled: () => {
      // A refetch while another action runs would briefly bring its thread back.
      if (queryClient.isMutating({ mutationKey: ACTION_KEY }) === 1) {
        void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
        void queryClient.invalidateQueries({ queryKey: FOLDERS_KEY })
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
