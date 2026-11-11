import { useQuery } from "@tanstack/react-query"
import type { Carrier, ShipmentStatus } from "@evido/mail-core/shipments"
import type { MailShipmentView } from "@evido/mail-core/types"
import { useBackgroundScan } from "@/lib/scan"
import { api } from "@/lib/api"
import { conversationUrl } from "@/lib/mail"

export const SHIPMENTS_KEY = ["mail-shipments"]

export const CARRIER_NAMES: Record<Carrier, string> = {
  postnl: "PostNL",
  dhl: "DHL",
  dpd: "DPD",
  gls: "GLS",
  ups: "UPS",
  budbee: "Budbee",
  trunkrs: "Trunkrs",
  dragonfly: "Dragonfly",
  amazon: "Amazon",
}

/** The colour of a status's dot: arrived, arriving, waiting for you, or in trouble. */
export const STATUS_TONE: Record<ShipmentStatus | "unknown", string> = {
  announced: "bg-muted-foreground/50",
  in_transit: "bg-sky-500",
  out_for_delivery: "bg-primary",
  pickup: "bg-violet-500",
  delivered: "bg-emerald-500",
  problem: "bg-destructive",
  unknown: "bg-muted-foreground/50",
}

/**
 * Parcels from shipping mail, straight from what is kept; shipping mail not
 * seen yet is read meanwhile, so `complete` false means more may follow.
 */
export function useShipments(enabled = true) {
  const complete = useBackgroundScan("/api/mail/shipments/scan", SHIPMENTS_KEY, enabled)
  const query = useQuery({
    queryKey: SHIPMENTS_KEY,
    queryFn: () => api<{ shipments: MailShipmentView[] }>("/api/mail/shipments"),
    enabled,
    staleTime: 60_000,
  })
  return { ...query, data: query.data && { ...query.data, complete } }
}

/** The parcel a conversation is about, for the card above it. */
export function useConversationShipment(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["mail-shipment", threadId],
    queryFn: () => api<{ shipment: MailShipmentView | null }>(conversationUrl(threadId, "/shipment")),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
