import { useQuery } from "@tanstack/react-query"
import { SparklesIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import type { MailReplySuggestion } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { conversationUrl } from "@/lib/mail"
import { useReplySuggestions } from "@/lib/preferences"

/**
 * Three replies to start from, above the reply bar, when the newest message asks
 * for an answer. Mail that doesn't gets none, and nothing shows while they are
 * being written.
 */
export function ReplySuggestions({
  threadId,
  newestId,
  onPick,
}: {
  threadId: string
  /** A new message asks again. */
  newestId: string
  onPick: (text: string) => void
}) {
  const t = useI18n().t.conversation
  const enabled = useReplySuggestions()
  const replies = useQuery({
    queryKey: ["mail-replies", threadId, newestId],
    queryFn: () => api<{ replies: MailReplySuggestion[] }>(conversationUrl(threadId, "/replies")),
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const list = replies.data?.replies ?? []
  if (!enabled || list.length === 0) return null
  return (
    <ul aria-label={t.replySuggestions} className="mb-2 flex flex-wrap justify-end gap-1.5">
      {list.map((reply) => (
        <li key={reply.label} className="min-w-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-w-full rounded-full bg-background/90 font-normal shadow-sm backdrop-blur-md"
            onClick={() => onPick(reply.text)}
          >
            <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" className="text-primary" />
            <span className="truncate">{reply.label}</span>
          </Button>
        </li>
      ))}
    </ul>
  )
}
