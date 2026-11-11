// Safe to import from browsers: no Node APIs here.
//
// Connections: other services a user links once, such as Moneybird, so mail
// can be handed to them in one click.

export const CONNECTION_PROVIDERS = ["moneybird"] as const
export type ConnectionProviderId = (typeof CONNECTION_PROVIDERS)[number]

export const isConnectionProvider = (value: string): value is ConnectionProviderId =>
  (CONNECTION_PROVIDERS as readonly string[]).includes(value)

/** Why a connect flow came back without a connection. */
export type ConnectionErrorCode = "denied" | "failed" | "session" | "expired" | "not_configured"

/** A Moneybird administration: one company's books. */
export type MoneybirdAdministration = { id: string; name: string }

export type ConnectionView = {
  provider: ConnectionProviderId
  status: "active" | "reauth_required"
  /** Where mail goes unless another is picked. Null: ask each time. */
  defaultTarget: MoneybirdAdministration | null
  /** Read live from the service; empty when it couldn't be reached. */
  administrations: MoneybirdAdministration[]
  createdAt: string
}

export type ConnectionsView = {
  connections: ConnectionView[]
  /** Services this server can connect to, because their app keys are set. */
  available: ConnectionProviderId[]
}

/** A file from a conversation that went to Moneybird. */
export type MoneybirdExportView = {
  messageId: string
  attachmentName: string
  /** Name and size, the same for the same file however often it is read. */
  attachmentKey: string
  administrationId: string
  administrationName: string
  url: string
  createdAt: string
}

export type MoneybirdThreadView = {
  exports: MoneybirdExportView[]
  /** The administration the last mail from this sender went to, if any. */
  suggestedAdministrationId: string | null
}

/** Moneybird reads PDFs and pictures of receipts. */
export const MONEYBIRD_MAX_BYTES = 25 * 1024 * 1024

type File = { name: string; contentType: string; size: number }

const isPdf = (file: File) => /pdf/i.test(file.contentType) || /\.pdf$/i.test(file.name)
const isPicture = (file: File) => /^image\/(jpe?g|png|heic|heif|webp)$/i.test(file.contentType) || /\.(jpe?g|png|heic)$/i.test(file.name)

/** Files worth booking: PDFs first; pictures only when there is no PDF, since mail is full of logos. */
export function bookableFiles<T extends File>(files: T[]): T[] {
  const fits = files.filter((file) => file.size > 0 && file.size <= MONEYBIRD_MAX_BYTES)
  const pdfs = fits.filter(isPdf)
  if (pdfs.length) return pdfs
  // A picture under 20 KB is a logo or an icon, not a receipt.
  return fits.filter((file) => isPicture(file) && file.size > 20_000)
}

const INVOICE_NAME = /factuur|invoice|receipt|nota|bon|rekening|rechnung|credit/i
const NOT_INVOICE_NAME = /voorwaarden|terms|conditions|privacy|algemene|brochure|flyer|nieuwsbrief|newsletter/i

/** The file most likely to be the invoice: named like one, not like terms and conditions. */
export function likeliestInvoiceFile<T extends File>(files: T[]): T | null {
  const score = (file: T) => (INVOICE_NAME.test(file.name) ? 2 : 0) - (NOT_INVOICE_NAME.test(file.name) ? 3 : 0)
  return files.reduce<T | null>((best, file) => (best === null || score(file) > score(best) ? file : best), null)
}

export const attachmentKey = (file: { name: string; size: number }) => `${file.size}:${file.name}`
