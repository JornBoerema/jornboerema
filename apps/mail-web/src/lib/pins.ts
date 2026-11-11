import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MailThreadsPage, MailThreadView } from "@evido/mail-core/types"
import { api, errorText } from "@/lib/api"
import { MESSAGES_KEY } from "@/lib/mail"
import { usePins } from "@/lib/preferences"

/**
 * Kept beside the folder lists, in their shape, so archiving takes a pinned
 * conversation off at once and every refresh of the lists refreshes this too.
 */
const pinsKey = (accountId: string) => [...MESSAGES_KEY, accountId, "pins"]

/** The conversations pinned to the top of the inbox, for one mailbox or all ("" ). */
export function usePinned(accountId: string, enabled = true) {
  const on = usePins()
  const query = useInfiniteQuery({
    queryKey: pinsKey(accountId),
    initialPageParam: "",
    queryFn: async () => {
      const params = accountId ? `?${new URLSearchParams({ account: accountId })}` : ""
      const { threads } = await api<{ threads: MailThreadView[] }>(`/api/mail/pins${params}`)
      return { threads, nextCursor: null } satisfies MailThreadsPage
    },
    getNextPageParam: () => null,
    enabled: on && enabled,
  })
  return on ? (query.data?.pages.flatMap((page) => page.threads) ?? []) : []
}

/** Pins or unpins, moving the line at once in every list of pinned conversations. */
export function usePin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ thread, pinned }: { thread: MailThreadView; pinned: boolean }) =>
      api(`/api/mail/threads/${encodeURIComponent(thread.id)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      }),
    onMutate: async ({ thread, pinned }) => {
      for (const accountId of ["", thread.accountId]) {
        const key = pinsKey(accountId)
        await queryClient.cancelQueries({ queryKey: key })
        queryClient.setQueryData<InfiniteData<MailThreadsPage>>(key, (data) => {
          const threads = (data?.pages ?? []).flatMap((page) => page.threads).filter((item) => item.id !== thread.id)
          const next = pinned
            ? [thread, ...threads].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
            : threads
          return { pages: [{ threads: next, nextCursor: null }], pageParams: [""] }
        })
      }
    },
    onError: (error) => toast.error(errorText(error)),
    onSettled: (_, __, { thread }) => {
      void queryClient.invalidateQueries({ queryKey: pinsKey("") })
      void queryClient.invalidateQueries({ queryKey: pinsKey(thread.accountId) })
    },
  })
}

/** Only conversations synced to the inbox can be pinned; a search hit from elsewhere can't. */
export const canPin = (thread: MailThreadView) => !thread.id.startsWith("remote:")
