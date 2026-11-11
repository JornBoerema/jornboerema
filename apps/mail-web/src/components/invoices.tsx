import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowUpRight01Icon, Copy01Icon, Invoice02Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import { looksLikeInvoice } from "@evido/mail-core/invoices"
import type { MailInvoiceView, MailThreadView } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { formatMoney, invoiceTone, useConversationInvoice } from "@/lib/invoices"
import { useInvoices } from "@/lib/preferences"
import { IconTip } from "@/components/icon-tip"

/** "20 Nov" for a due date written as yyyy-mm-dd, read as a calendar day. */
const dueLabel = (date: string, locale: string) => {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(locale, { day: "numeric", month: "short" })
}

/** The status in words with its dot, and when it must be paid by or that it is late. */
export function InvoiceStatus({ invoice }: { invoice: MailInvoiceView }) {
  const { t: strings, locale } = useI18n()
  const t = strings.invoices
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", invoiceTone(invoice))} aria-hidden="true" />
      <span className="truncate">
        {invoice.overdue ? t.overdue : t.status[invoice.status]}
        {invoice.status === "due" && invoice.dueDate && ` · ${t.dueOn(dueLabel(invoice.dueDate, locale))}`}
      </span>
    </span>
  )
}

function CopyNumber({ number }: { number: string }) {
  const strings = useI18n().t
  const t = strings.invoices
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <IconTip label={t.copyNumber}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t.copyNumber}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(number)
            setCopied(true)
            toast.success(t.numberCopied)
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
 * Above mail about money: who wants how much, by when, and whether it is paid,
 * with its number to copy and a way to pay when the mail has one. Only mail
 * that looks like it (by sender and subject) is asked about.
 */
export function InvoiceCard({ threadId, thread }: { threadId: string; thread: MailThreadView }) {
  const { t: strings, locale } = useI18n()
  const t = strings.invoices
  const candidate = useInvoices() && looksLikeInvoice(thread)
  const { data } = useConversationInvoice(threadId, candidate)
  const invoice = data?.invoice
  if (!candidate || !invoice) return null
  return (
    <section className="mb-3 flex items-center gap-4 rounded-xl border bg-muted/40 px-4 py-3" aria-label={t.title}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground ring-1 ring-border">
        <HugeiconsIcon icon={Invoice02Icon} strokeWidth={1.75} aria-hidden="true" className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs text-muted-foreground">{invoice.vendor}</span>
        <span className="text-base font-semibold tabular-nums">
          {invoice.amountCents !== null ? formatMoney(invoice.amountCents, invoice.currency, locale) : t.amountUnknown}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <InvoiceStatus invoice={invoice} />
          {invoice.invoiceNumber && (
            <span className="flex min-w-0 items-center gap-0.5 font-mono">
              <span className="truncate select-all">#{invoice.invoiceNumber}</span>
              <CopyNumber number={invoice.invoiceNumber} />
            </span>
          )}
        </span>
      </div>
      {invoice.payUrl && (
        <Button size="sm" asChild>
          <a href={invoice.payUrl} target="_blank" rel="noopener noreferrer">
            {t.pay}
            <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.75} data-icon="inline-end" aria-hidden="true" />
          </a>
        </Button>
      )}
    </section>
  )
}
