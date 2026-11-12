import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy01Icon, SparklesIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Skeleton } from "@evido/ui/components/skeleton"
import type { MailSummary } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { conversationUrl } from "@/lib/mail"
import { useFindCodes, useSummaries } from "@/lib/preferences"

const CARD = "mb-3 rounded-lg border bg-muted/40 px-4 py-3"

function CodeCard({ code }: { code: string }) {
  const t = useI18n().t.conversation
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <div className={`${CARD} flex items-center gap-4`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{t.code}</span>
        <span className="font-mono text-2xl font-semibold tracking-[0.2em] select-all">{code}</span>
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label={t.copyCode}
        onClick={async () => {
          try {
            // Spaces and dashes are for reading; sites want the bare code.
            await navigator.clipboard.writeText(code.replace(/[\s-]/g, ""))
            setCopied(true)
            toast.success(t.codeCopied)
          } catch {
            toast.error(t.copyFailed)
          }
        }}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={1.75} aria-hidden="true" />
      </Button>
    </div>
  )
}

/**
 * Above a conversation: a sign-in code ready to copy, or three lines on what it
 * says. Made when opened and kept only for this session.
 */
export function MailSummaryCard({ threadId }: { threadId: string }) {
  const t = useI18n().t.conversation
  const summaries = useSummaries()
  const codes = useFindCodes()
  // Each feature can be off on its own; with both off nothing is asked at all.
  const summary = useQuery({
    queryKey: ["mail-summary", threadId, summaries, codes],
    queryFn: () => {
      const url = conversationUrl(threadId, "/summary")
      const off = [!summaries && "ai=0", !codes && "codes=0"].filter(Boolean).join("&")
      return api<MailSummary>(off ? `${url}${url.includes("?") ? "&" : "?"}${off}` : url)
    },
    enabled: summaries || codes,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  if (!summaries && !codes) return null
  // A code shows once it is found; only a summary being written is worth a placeholder.
  if (summary.isPending && !summaries) return null
  if (summary.isPending)
    return (
      <div className={CARD} aria-hidden="true">
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="mb-1.5 h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
    )
  // Without a summary the conversation reads as before; a failure isn't worth a warning.
  if (summary.isError || summary.data.kind === "none") return null
  if (summary.data.kind === "code") return <CodeCard code={summary.data.code} />
  return (
    <section className={CARD} aria-label={t.summary}>
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.75} aria-hidden="true" className="size-3.5" />
        {t.summary}
      </p>
      <p className="text-sm text-pretty">{summary.data.summary}</p>
    </section>
  )
}
