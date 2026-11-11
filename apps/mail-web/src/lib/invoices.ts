import { useQuery } from "@tanstack/react-query"
import type { MailInvoiceView } from "@evido/mail-core/types"
import { api } from "@/lib/api"
import { conversationUrl } from "@/lib/mail"

export const INVOICES_KEY = ["mail-invoices"]

/** Invoices from mail. Asking also reads mail about money not seen yet; `complete` false means more may follow. */
export function useInvoiceList(enabled: boolean) {
  return useQuery({
    queryKey: INVOICES_KEY,
    queryFn: () => api<{ invoices: MailInvoiceView[]; complete: boolean }>("/api/mail/invoices"),
    enabled,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.complete === false ? 5_000 : false),
  })
}

export function useConversationInvoice(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["mail-invoice", threadId],
    queryFn: () => api<{ invoice: MailInvoiceView | null }>(conversationUrl(threadId, "/invoice")),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

/** "€ 121,00", "$20.00": in the reader's locale, in the invoice's currency. `round` drops the cents, for sums. */
export function formatMoney(cents: number, currency: string | null, locale: string, round = false) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency ?? "EUR",
      currencyDisplay: "narrowSymbol",
      ...(round && { maximumFractionDigits: 0, minimumFractionDigits: 0 }),
    }).format(cents / 100)
  } catch {
    return `${currency ?? ""} ${(cents / 100).toFixed(2)}`.trim()
  }
}

/** Waiting to be paid by you: neither paid, nor collected automatically. */
export const isOpen = (invoice: MailInvoiceView) => invoice.status === "due" || invoice.status === "failed"

/** A dot's colour per status: green paid, muted automatic, orange to pay, red late or failed. */
export const invoiceTone = (invoice: MailInvoiceView) =>
  invoice.status === "failed" || invoice.overdue
    ? "bg-destructive"
    : invoice.status === "paid"
      ? "bg-emerald-500"
      : invoice.status === "auto"
        ? "bg-muted-foreground/50"
        : "bg-primary"
