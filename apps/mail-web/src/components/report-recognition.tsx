import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Flag02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { INVOICES_KEY } from "@/lib/invoices"
import { SHIPMENTS_KEY } from "@/lib/shipments"
import { IconTip } from "@/components/icon-tip"

export type RecognitionKind = "parcel" | "invoice"
type Reason = "not_one" | "amount" | "status" | "other"

/** Only synced conversations can be reported; a search hit from the provider has no row to drop. */
export const canReport = (threadId: string | undefined) => !!threadId && !threadId.startsWith("remote:")

function useReport(kind: RecognitionKind, threadId: string) {
  const queryClient = useQueryClient()
  const t = useI18n().t.recognition
  return useMutation({
    mutationFn: (reason: Reason) =>
      api(`/api/mail/threads/${encodeURIComponent(threadId)}/recognition/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, reason }),
      }),
    onSuccess: () => {
      toast.success(t.reported)
      void queryClient.invalidateQueries({ queryKey: kind === "parcel" ? SHIPMENTS_KEY : INVOICES_KEY, exact: true })
      void queryClient.invalidateQueries({ queryKey: [kind === "parcel" ? "mail-shipment" : "mail-invoice", threadId] })
    },
    onError: (error) => toast.error(errorText(error)),
  })
}

/**
 * "Not recognised well": what was wrong, in one click. The mail leaves the
 * list, and the report keeps what was read from it so the reading can improve.
 */
export function ReportRecognitionDialog({
  kind,
  threadId,
  open,
  onOpenChange,
}: {
  kind: RecognitionKind
  threadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useI18n().t.recognition
  const report = useReport(kind, threadId)
  const reasons: { reason: Reason; label: string }[] = [
    { reason: "not_one", label: kind === "parcel" ? t.parcelNotOne : t.invoiceNotOne },
    ...(kind === "invoice" ? [{ reason: "amount" as const, label: t.amount }] : []),
    { reason: "status", label: t.status },
    { reason: "other", label: t.other },
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onClick={(event) => event.stopPropagation()}>
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
        <div className="flex flex-col gap-1.5 pt-1">
          {reasons.map(({ reason, label }) => (
            <Button
              key={reason}
              variant="outline"
              className="justify-start"
              disabled={report.isPending}
              onClick={() => report.mutate(reason, { onSuccess: () => onOpenChange(false) })}
            >
              {label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The flag on a card above the mail. */
export function ReportRecognitionButton({ kind, threadId }: { kind: RecognitionKind; threadId: string }) {
  const t = useI18n().t.recognition
  const [open, onOpenChange] = useState(false)
  if (!canReport(threadId)) return null
  return (
    <>
      <IconTip label={t.report}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t.report}
          onClick={() => onOpenChange(true)}
        >
          <HugeiconsIcon icon={Flag02Icon} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </IconTip>
      <ReportRecognitionDialog kind={kind} threadId={threadId} open={open} onOpenChange={onOpenChange} />
    </>
  )
}
