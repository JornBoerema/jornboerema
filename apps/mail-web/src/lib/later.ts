import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MailScheduledView, MailSnoozedView } from "@evido/mail-core/types"
import { api, errorText } from "@/lib/api"
import { DRAFTS_KEY } from "@/lib/drafts"
import { useI18n } from "@/i18n"

export const SNOOZES_KEY = ["mail-snoozes"]
export const SCHEDULED_KEY = ["mail-scheduled"]

/** Waiting conversations, soonest first, and those just back for the inbox's top. */
export function useSnoozes() {
  return useQuery({
    queryKey: SNOOZES_KEY,
    queryFn: () => api<{ snoozed: MailSnoozedView[]; returned: MailSnoozedView[] }>("/api/mail/snoozes"),
    staleTime: 30_000,
  })
}

export function useScheduled() {
  return useQuery({
    queryKey: SCHEDULED_KEY,
    queryFn: () => api<{ scheduled: MailScheduledView[] }>("/api/mail/scheduled"),
    staleTime: 30_000,
  })
}

/** How many are snoozed and scheduled, for the sidebar. */
export function useLaterCounts() {
  const snoozes = useSnoozes()
  const scheduled = useScheduled()
  return {
    snoozedCount: snoozes.data?.snoozed.length ?? 0,
    scheduledCount: scheduled.data?.scheduled.length ?? 0,
  }
}

/** "tomorrow 08:00", "Friday 10:00", "12 Dec 08:00": short, for toasts and lines. */
export function formatMoment(date: Date, locale: string, now = new Date()) {
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  const days = Math.round(
    (new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000
  )
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  if (days === 0 || days === 1) return `${relative.format(days, "day")} ${time}`
  if (days > 1 && days < 7) return `${date.toLocaleDateString(locale, { weekday: "long" })} ${time}`
  return `${date.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`
}

/** Unsnoozing: back to the inbox now. */
export function useUnsnooze() {
  const queryClient = useQueryClient()
  const t = useI18n().t.later
  return useMutation({
    mutationFn: (messageId: string) =>
      api(`/api/mail/threads/${encodeURIComponent(messageId)}/snooze`, { method: "DELETE" }),
    onSuccess: () => toast.success(t.unsnoozed),
    onError: (error) => toast.error(errorText(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SNOOZES_KEY })
      void queryClient.invalidateQueries({ queryKey: ["mail-messages"] })
    },
  })
}

/** Scheduled mail: send it now, or keep it as a draft instead. */
export function useScheduledActions() {
  const queryClient = useQueryClient()
  const t = useI18n().t.later
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: SCHEDULED_KEY })
    void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY })
  }
  const sendNow = useMutation({
    mutationFn: (id: string) => api(`/api/mail/scheduled/${encodeURIComponent(id)}/send`, { method: "POST" }),
    onSuccess: () => toast.success(t.sentNow),
    onError: (error) => toast.error(errorText(error)),
    onSettled: settle,
  })
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api<{ accountId: string; draftId: string }>(`/api/mail/scheduled/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onError: (error) => toast.error(errorText(error)),
    onSettled: settle,
  })
  return { sendNow, cancel }
}
