import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowUpRight01Icon, Copy01Icon, PackageIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import { looksLikeShipment } from "@evido/mail-core/shipments"
import type { MailShipmentView, MailThreadView } from "@evido/mail-core/types"
import { ReportRecognitionButton } from "@/components/report-recognition"
import { useI18n } from "@/i18n"
import { useParcels } from "@/lib/preferences"
import { CARRIER_NAMES, STATUS_TONE, useConversationShipment } from "@/lib/shipments"

export const carrierName = (shipment: MailShipmentView, fallback: string) =>
  shipment.carrier ? CARRIER_NAMES[shipment.carrier] : fallback

/** A coloured dot and the status in words. */
export function Status({ shipment }: { shipment: MailShipmentView }) {
  const t = useI18n().t.parcels
  const status = shipment.status ?? "unknown"
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE[status])} aria-hidden="true" />
      {t.status[status]}
    </span>
  )
}

function CopyCode({ code }: { code: string }) {
  const strings = useI18n().t
  const t = strings.parcels
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={t.copyCode}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          toast.success(t.codeCopied)
        } catch {
          toast.error(strings.conversation.copyFailed)
        }
      }}
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={1.75} aria-hidden="true" />
    </Button>
  )
}

/**
 * Above a shipping conversation: where the parcel is, its code and the way to
 * its track & trace page. Only shipping mail (by sender and subject) is asked about.
 */
export function ShipmentCard({ threadId, thread }: { threadId: string; thread: MailThreadView }) {
  const t = useI18n().t.parcels
  const candidate = useParcels() && looksLikeShipment(thread)
  const { data } = useConversationShipment(threadId, candidate)
  const shipment = data?.shipment
  if (!candidate || !shipment) return null
  return (
    <section className="mb-3 flex items-center gap-4 rounded-lg border bg-muted/40 px-4 py-3" aria-label={t.trackParcel}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground ring-1 ring-border">
        <HugeiconsIcon icon={PackageIcon} strokeWidth={1.75} aria-hidden="true" className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs text-muted-foreground">
          {[carrierName(shipment, t.unknownCarrier), shipment.merchant].filter(Boolean).join(" · ")}
        </span>
        <span className="text-sm font-medium">
          <Status shipment={shipment} />
        </span>
        {shipment.trackingCode && (
          <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <span className="truncate select-all">{shipment.trackingCode}</span>
            <CopyCode code={shipment.trackingCode} />
          </span>
        )}
      </div>
      {shipment.trackingUrl && (
        <Button variant="outline" size="sm" asChild>
          <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer">
            {t.trackParcel}
            <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.75} data-icon="inline-end" aria-hidden="true" />
          </a>
        </Button>
      )}
      <ReportRecognitionButton kind="parcel" threadId={threadId} />
    </section>
  )
}
