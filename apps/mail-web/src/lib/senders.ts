import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MailSenderView, MailThreadView } from "@evido/mail-core/types"
import { api, ApiError, errorText } from "@/lib/api"
import { conversationUrl, MESSAGES_KEY, UNREAD_KEY } from "@/lib/mail"
import { useI18n } from "@/i18n"

export const SENDERS_KEY = ["mail-senders"]

export type SenderAction = "archive" | "read" | "trash"

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

export const nameOf = (sender: MailSenderView) => sender.name ?? sender.email

/** Their conversations in the inbox, newest first, for the sender pane. */
export function useSenderConversations(email: string | null, accountId: string) {
  return useQuery({
    queryKey: [...SENDERS_KEY, "conversations", email, accountId],
    queryFn: () =>
      api<{ threads: MailThreadView[] }>(
        `/api/mail/senders/conversations?email=${encodeURIComponent(email!)}${accountId ? `&account=${encodeURIComponent(accountId)}` : ""}`
      ),
    enabled: email !== null,
    staleTime: 30_000,
  })
}

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
    mutationFn: async ({ sender, action }: { sender: MailSenderView; action: SenderAction }) => {
      const total = action === "read" ? sender.unread : sender.conversations
      const toastId = `tidy:${sender.email}:${action}`
      const counting = { archive: t.archiving, read: t.reading, trash: t.trashing }[action]
      const progress = (done: number) => toast.loading(counting(done, total), { id: toastId })
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
        const name = nameOf(sender)
        const finished = { archive: t.archived(done, name), read: t.read(name), trash: t.trashed(done, name) }[action]
        toast.success(finished, { id: toastId })
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
