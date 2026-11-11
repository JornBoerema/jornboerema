import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { TranslateIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Skeleton } from "@evido/ui/components/skeleton"
import type { MailTranslation } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { conversationUrl } from "@/lib/mail"

/** One message in the reader's language. Asked for on request and kept for this session. */
function useTranslation(threadId: string, messageId: string, enabled: boolean) {
  const { locale } = useI18n()
  return useQuery({
    queryKey: ["mail-translation", threadId, messageId, locale],
    queryFn: () => {
      const url = conversationUrl(threadId, "/translation")
      return api<MailTranslation>(`${url}${url.includes("?") ? "&" : "?"}message=${encodeURIComponent(messageId)}`)
    },
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

/** Switches a message between the original and its translation. */
export function TranslateButton({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useI18n().t.conversation
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="shrink-0 text-muted-foreground"
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <HugeiconsIcon icon={TranslateIcon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" />
      {on ? t.showOriginal : t.translate}
    </Button>
  )
}

/**
 * In place of the message while translated. Mail already in the reader's language
 * or a failed translation turns back to the original, with a note why.
 */
export function MessageTranslation({
  threadId,
  messageId,
  onDone,
}: {
  threadId: string
  messageId: string
  /** Back to the original. */
  onDone: () => void
}) {
  const t = useI18n().t.conversation
  const translation = useTranslation(threadId, messageId, true)

  useEffect(() => {
    if (translation.isError) {
      toast.error(errorText(translation.error))
      onDone()
    } else if (translation.data?.same) {
      toast(t.alreadyInLanguage)
      onDone()
    }
  }, [translation.isError, translation.error, translation.data, onDone, t])

  if (translation.isPending)
    return (
      <div className="flex flex-col gap-1.5" aria-busy="true" aria-label={t.translating}>
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    )
  if (!translation.data || translation.data.same) return null
  return (
    <section aria-label={t.translation} className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <HugeiconsIcon icon={TranslateIcon} strokeWidth={1.75} aria-hidden="true" className="size-3.5" />
        {translation.data.from ? t.translatedFrom(translation.data.from) : t.translated}
      </p>
      <p className="leading-relaxed break-words whitespace-pre-wrap">{translation.data.text}</p>
    </section>
  )
}
