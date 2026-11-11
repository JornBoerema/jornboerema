// Safe to import from browsers: no Node APIs here.
//
// Invoices, receipts and payment requests in mail: who wants how much, by
// when, and whether it is paid, as the mail says. Nothing is looked up online.

export const INVOICE_STATUSES = ["due", "paid", "auto", "failed"] as const
/** due: to pay. paid: a receipt. auto: collected or charged without you. failed: a payment that didn't go through. */
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export type FoundInvoice = {
  vendor: string | null
  /** In cents, so sums stay exact. */
  amountCents: number | null
  currency: string | null
  /** yyyy-mm-dd, the day it must be paid by. */
  dueDate: string | null
  invoiceNumber: string | null
  /** A link to pay it, when the mail has one. */
  payUrl: string | null
  status: InvoiceStatus
  /** A reminder or a demand: it is late. */
  overdue: boolean
}

type Mail = {
  subject: string
  fromName: string | null
  fromEmail: string | null
  html: string | null
  text: string | null
  hasAttachments?: boolean
}

/** Senders that only ever mail about money. */
const BILLING_DOMAINS =
  /(^|\.)(stripe\.com|mollie\.com|paddle\.com|paypal\.(com|nl)|tikkie\.me|abnamro\.nl|moneybird\.(nl|com)|exactonline\.nl|e-boekhouden\.nl|sumup\.com|adyen\.com|lemonsqueezy\.com|chargebee\.com|invoice\.(stripe|chargebee)\.com)$/

const SUBJECT =
  /factuur|facturen|invoice|receipt|bon\b|kassabon|ontvangstbewijs|betaalbewijs|betaalverzoek|betaling|payment|tikkie|nota\b|rekening\b|aanmaning|herinnering.*(betaling|factuur)|incasso|afschrijving|charge|billing|subscription renew|abonnement.*(verlengd|vernieuwd)|order confirmation|bestelbevestiging|rechnung|zahlung|quittung/i

const domainOf = (email: string | null) => (email?.split("@")[1] ?? "").toLowerCase()

/** From the list alone (sender and subject): might this be about money? Cheap, so only these are read. */
export function looksLikeInvoice({ fromEmail, subject }: { fromEmail: string | null; subject: string }) {
  return BILLING_DOMAINS.test(domainOf(fromEmail)) || SUBJECT.test(subject)
}

const plainText = (mail: Mail) =>
  (mail.text?.trim() || (mail.html ?? "").replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&euro;/g, "€")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")

const CURRENCY_SIGNS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" }

/** "1.234,56", "1,234.56", "12,50", "12.5", "12": to cents. */
function toCents(raw: string): number | null {
  const value = raw.replace(/\s/g, "")
  const comma = value.lastIndexOf(",")
  const dot = value.lastIndexOf(".")
  let normal: string
  if (comma > dot) normal = value.replace(/\./g, "").replace(",", ".")
  else if (dot > comma && value.length - dot - 1 !== 3) normal = value.replace(/,/g, "")
  else normal = value.replace(/[.,]/g, "")
  const number = Number(normal)
  return Number.isFinite(number) && number > 0 && number < 10_000_000 ? Math.round(number * 100) : null
}

const AMOUNT = /(€|\$|£|EUR|USD|GBP)\s?(-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d)|(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s?(€|EUR|USD|GBP)\b/gi

/** Words that sit beside the amount that matters, rather than a line item. */
const TOTAL_WORDS = /totaal|total|te betalen|amount due|balance due|bedrag|amount|charged|afgeschreven|incasso|betaald|paid|summe|gesamt/i

function amountIn(text: string): { cents: number; currency: string } | null {
  const found: { cents: number; currency: string; index: number; total: boolean }[] = []
  for (const match of text.matchAll(AMOUNT)) {
    const sign = (match[1] ?? match[4] ?? "").toUpperCase()
    const cents = toCents(match[2] ?? match[3] ?? "")
    if (cents === null) continue
    const index = match.index ?? 0
    const before = text.slice(Math.max(0, index - 50), index)
    found.push({ cents, currency: CURRENCY_SIGNS[sign] ?? sign, index, total: TOTAL_WORDS.test(before) })
  }
  if (found.length === 0) return null
  // The total, where the mail names one; else the largest, which is the total more often than not.
  const totals = found.filter((item) => item.total)
  const pick = (totals.length ? totals : found).reduce((best, item) => (item.cents > best.cents ? item : best))
  return { cents: pick.cents, currency: pick.currency }
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mrt: 3, maart: 3, mar: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, augustus: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const pad = (value: number) => String(value).padStart(2, "0")

/** "20-11-2026", "20 november 2026", "Nov 20, 2026", "2026-11-20". */
function dateIn(text: string): string | null {
  let match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  match = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/)
  if (match) return `${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`
  match = text.match(/\b(\d{1,2}) ([a-z]+)\.? (\d{4})\b/i)
  if (match && MONTHS[match[2].toLowerCase()]) return `${match[3]}-${pad(MONTHS[match[2].toLowerCase()])}-${pad(Number(match[1]))}`
  match = text.match(/\b([a-z]+)\.? (\d{1,2}),? (\d{4})\b/i)
  if (match && MONTHS[match[1].toLowerCase()]) return `${match[3]}-${pad(MONTHS[match[1].toLowerCase()])}-${pad(Number(match[2]))}`
  return null
}

function dueDateIn(text: string): string | null {
  const near = text.match(
    /(?:vervaldatum|uiterlijk|(?:betaal|betalen) (?:vóór|voor|uiterlijk)|te betalen (?:vóór|voor)|due date|due by|payment due|pay by|fällig)[^\n]{0,40}/i
  )
  return near ? dateIn(near[0]) : null
}

function invoiceNumberIn(subject: string, text: string): string | null {
  const pattern =
    /(?:factuurnummer|factuur ?nr\.?|factuur|invoice (?:number|no\.?|#)|invoice|receipt (?:number|#)|bonnummer|rechnungsnummer)\s*[:#]?\s*([A-Z0-9][A-Z0-9-/]{3,30})/i
  for (const source of [subject, text]) {
    const match = source.match(pattern)
    // A number has digits; "Invoice from Stripe" isn't one.
    if (match && /\d/.test(match[1])) return match[1].replace(/[.,]$/, "")
  }
  return null
}

/** A link to pay: Tikkie, iDEAL, a payment page. */
function payUrlIn(html: string): string | null {
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(https:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[2].replace(/&amp;/g, "&")
    const label = match[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (/tikkie\.me|ideal|pay\.|betaal|checkout|\/pay\b|payment-link|invoice\.stripe\.com/i.test(href)) return href
    if (/^(nu )?betalen|^betaal|pay (now|invoice|online)|^pay\b|betaal nu|bekijk en betaal/i.test(label)) return href
  }
  return null
}

/** Checked from the most decisive: a failure outweighs everything, a receipt outweighs "invoice". */
const STATUS_PATTERNS: [InvoiceStatus, RegExp][] = [
  ["failed", /betaling (is )?mislukt|niet (gelukt|geslaagd)|payment (has )?failed|could not be (processed|charged)|declined|geweigerd|unsuccessful|zahlung fehlgeschlagen/i],
  [
    "paid",
    /betaling ontvangen|bedankt voor je betaling|thanks for your payment|payment received|we('ve| have) received your payment|ontvangstbewijs|betaalbewijs|\breceipt\b|kassabon|\bbetaald\b|\bpaid\b|zahlung erhalten|quittung/i,
  ],
  ["auto", /debit initiated|sepa|automatische incasso|automatisch (afgeschreven|geïncasseerd)|wordt (automatisch )?(afgeschreven|geïncasseerd)|incasso|direct debit|will be charged|charged to your|automatically charged|abgebucht/i],
]

const OVERDUE = /aanmaning|herinnering|reminder|overdue|achterstallig|past due|verlopen|nog niet ontvangen|not (yet )?received|nog open|openstaand|mahnung/i

/** "Stripe via Vercel" → Vercel; "Vercel Billing" → Vercel. */
function vendorOf(name: string | null, email: string | null) {
  const cleaned = name
    ?.replace(/\s+via\s+.+$/i, "")
    .replace(/\s+(billing|invoices?|facturen|facturatie|administratie|receipts?|payments?|no-?reply)$/i, "")
    .replace(/["']/g, "")
    .trim()
  if (cleaned) return cleaned
  const domain = domainOf(email).split(".").slice(-2, -1)[0]
  return domain ? domain[0].toUpperCase() + domain.slice(1) : null
}

/**
 * What a mail says about money, or null when it isn't an invoice, receipt or
 * payment request: it needs an amount, or a clear word and an attachment.
 */
export function findInvoice(mail: Mail): FoundInvoice | null {
  const text = plainText(mail).slice(0, 30_000)
  const opening = `${mail.subject}\n${text.slice(0, 1500)}`
  const money = amountIn(`${mail.subject}\n${text}`)
  const aboutMoney = SUBJECT.test(mail.subject) || BILLING_DOMAINS.test(domainOf(mail.fromEmail))
  if (!aboutMoney) return null
  const status = STATUS_PATTERNS.find(([, pattern]) => pattern.test(opening))?.[0] ?? "due"
  const overdue = status === "due" && OVERDUE.test(opening)
  // Without an amount or an attachment, only a failed payment or a reminder is worth
  // a line, and only when the subject itself is about money: a billing company's
  // product news ("[Reminder] new dashboard") isn't.
  if (!money && !mail.hasAttachments && ((status !== "failed" && !overdue) || !SUBJECT.test(mail.subject))) return null

  const dueDate = status === "due" ? dueDateIn(text) : null
  return {
    vendor: vendorOf(mail.fromName, mail.fromEmail),
    amountCents: money?.cents ?? null,
    currency: money?.currency ?? null,
    dueDate,
    invoiceNumber: invoiceNumberIn(mail.subject, text),
    payUrl: status === "due" || status === "failed" ? payUrlIn(mail.html ?? "") : null,
    status,
    overdue,
  }
}

/** One invoice from a conversation, oldest first: the newest message decides, earlier ones fill gaps. */
export function findInvoiceInThread(messages: Mail[]): FoundInvoice | null {
  let found = null as FoundInvoice | null
  for (const message of messages) {
    const invoice = findInvoice(message)
    if (!invoice) continue
    found = found
      ? {
          ...invoice,
          vendor: invoice.vendor ?? found.vendor,
          amountCents: invoice.amountCents ?? found.amountCents,
          currency: invoice.currency ?? found.currency,
          dueDate: invoice.dueDate ?? found.dueDate,
          invoiceNumber: invoice.invoiceNumber ?? found.invoiceNumber,
          payUrl: invoice.payUrl ?? found.payUrl,
        }
      : invoice
  }
  return found
}
