import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowUpRight01Icon, Copy01Icon, PackageIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import { looksLikeShipment } from "@evido/mail-core/shipments"
import type { MailShipmentView, MailThreadView } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { shortDate } from "@/lib/dates"
import { CARRIER_NAMES, STATUS_TONE, useConversationShipment } from "@/lib/shipments"
import { IconTip } from "@/components/icon-tip"

const carrierName = (shipment: MailShipmentView, fallback: string) =>
  shipment.carrier ? CARRIER_NAMES[shipment.carrier] : fallback

/** A coloured dot and the status in words. */
function Status({ shipment }: { shipment: MailShipmentView }) {
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
    <IconTip label={t.copyCode}>
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
    </IconTip>
  )
}

/**
 * Above a shipping conversation: where the parcel is, its code and the way to
 * its track & trace page. Only shipping mail (by sender and subject) is asked about.
 */
export function ShipmentCard({ threadId, thread }: { threadId: string; thread: MailThreadView }) {
  const t = useI18n().t.parcels
  const candidate = looksLikeShipment(thread)
  const { data } = useConversationShipment(threadId, candidate)
  const shipment = data?.shipment
  if (!candidate || !shipment) return null
  return (
    <section className="mb-3 flex items-center gap-4 rounded-xl border bg-muted/40 px-4 py-3" aria-label={t.trackParcel}>
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
    </section>
  )
}

/** One parcel in the Parcels list: opens its mail; the arrow opens its tracking page. */
export function ParcelRow({
  shipment,
  selected,
  onOpen,
}: {
  shipment: MailShipmentView
  selected: boolean
  onOpen: (thread: MailThreadView) => void
}) {
  const { t, locale } = useI18n()
  const p = t.parcels
  const title = shipment.merchant ?? carrierName(shipment, p.unknownCarrier)
  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        disabled={!shipment.thread}
        onClick={() => shipment.thread && onOpen(shipment.thread)}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 pr-11 text-left text-sm transition-colors outline-none focus-visible:bg-accent",
          selected ? "bg-accent" : "group-hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {shortDate(shipment.receivedAt, locale)}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Status shipment={shipment} />
          {shipment.merchant && shipment.carrier && <span className="truncate">· {CARRIER_NAMES[shipment.carrier]}</span>}
        </span>
      </button>
      {shipment.trackingUrl && (
        <IconTip label={p.trackParcel}>
          <Button
            variant="ghost"
            size="icon-sm"
            asChild
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
          >
            <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" aria-label={p.trackParcel}>
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </Button>
        </IconTip>
      )}
    </li>
  )
}
