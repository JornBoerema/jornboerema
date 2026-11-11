import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MailSenderView } from "@evido/mail-core/types"
import { api, ApiError, errorText } from "@/lib/api"
import { conversationUrl, MESSAGES_KEY, UNREAD_KEY } from "@/lib/mail"
import { useI18n } from "@/i18n"

export const SENDERS_KEY = ["mail-senders"]

/** Who fills the inbox, busiest first, for one mailbox or all. */
export function useSenderList(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...SENDERS_KEY, accountId],
    queryFn: () =>
      api<{ senders: MailSenderView[] }>(`/api/mail/senders${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`),
    enabled,
    staleTime: 30_000,
  })
}

const nameOf = (sender: MailSenderView) => sender.name ?? sender.email

/**
 * Everything from one sender at once: archive or mark read, in rounds the API
 * can finish in time, with a toast that counts along. Unsubscribing goes
 * through their newest message.
 */
export function useTidy(accountId: string) {
  const queryClient = useQueryClient()
  const t = useI18n().t.senders
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: SENDERS_KEY })
    void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
    void queryClient.invalidateQueries({ queryKey: UNREAD_KEY })
  }

  const act = useMutation({
    mutationFn: async ({ sender, action }: { sender: MailSenderView; action: "archive" | "read" }) => {
      const total = action === "archive" ? sender.conversations : sender.unread
      const toastId = `tidy:${sender.email}:${action}`
      const progress = (done: number) =>
        toast.loading(action === "archive" ? t.archiving(done, total) : t.reading(done, total), { id: toastId })
      let done = 0
      progress(0)
      try {
        for (;;) {
          const round = await api<{ handled: number; remaining: number }>("/api/mail/senders/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: sender.email, action, ...(accountId && { account: accountId }) }),
          })
          done += round.handled
          if (round.remaining === 0) break
          // A round that got nowhere won't do better next time.
          if (round.handled === 0) throw new Error(t.stopped)
          progress(Math.min(done, total))
        }
        toast.success(action === "archive" ? t.archived(done, nameOf(sender)) : t.read(nameOf(sender)), { id: toastId })
      } catch (error) {
        toast.error(errorText(error), { id: toastId })
      }
    },
    onSettled: settle,
  })

  const unsubscribe = useMutation({
    mutationFn: async (sender: MailSenderView) => {
      if (!sender.thread) throw new ApiError(t.noUnsubscribe(nameOf(sender)), 400)
      try {
        return await api<{ done: true } | { done: false; url: string }>(conversationUrl(sender.thread.id, "/unsubscribe"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: sender.providerMessageId }),
        })
      } catch (error) {
        // Nothing in their headers to unsubscribe with.
        if (error instanceof ApiError && error.status === 400) throw new ApiError(t.noUnsubscribe(nameOf(sender)), 400)
        throw error
      }
    },
    onSuccess: (result, sender) => {
      if (!result.done) {
        window.open(result.url, "_blank", "noopener,noreferrer")
        return
      }
      toast.success(t.unsubscribed(nameOf(sender)), {
        action: { label: t.alsoArchive, onClick: () => act.mutate({ sender, action: "archive" }) },
      })
    },
    onError: (error) => toast.error(errorText(error)),
  })

  return { act, unsubscribe }
}
