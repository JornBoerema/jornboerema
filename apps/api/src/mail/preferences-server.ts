import { getDb, Prisma } from "@evido/db"
import { normalizeSidebar, type SidebarLayout } from "@evido/mail-core/sidebar"

export type MailPreferences = {
  summaries: boolean
  codes: boolean
  aiWriting: boolean
  remoteImages: boolean
  parcels: boolean
  unsubscribe: boolean
  senders: boolean
  invoices: boolean
  todos: boolean
  pins: boolean
  sidebar: SidebarLayout | null
}

const select = {
  summaries: true,
  codes: true,
  aiWriting: true,
  remoteImages: true,
  parcels: true,
  unsubscribe: true,
  senders: true,
  invoices: true,
  todos: true,
  pins: true,
  sidebar: true,
} as const

/** Null until first saved, so the first device can bring along what it had chosen. */
export async function readPreferences(userId: string): Promise<MailPreferences | null> {
  const saved = await getDb().mailPreferences.findUnique({ where: { userId }, select })
  return saved && { ...saved, sidebar: saved.sidebar === null ? null : normalizeSidebar(saved.sidebar) }
}

/** Whether Parcels is on: it is unless turned off. */
export async function parcelsEnabled(userId: string) {
  return (await readPreferences(userId))?.parcels ?? true
}

/** Whether Invoices is on: it is unless turned off. */
export async function invoicesEnabled(userId: string) {
  return (await readPreferences(userId))?.invoices ?? true
}

/** Whether pinning is on: it is unless turned off. */
export async function pinsEnabled(userId: string) {
  return (await readPreferences(userId))?.pins ?? true
}

export async function savePreferences(userId: string, input: Partial<MailPreferences>): Promise<MailPreferences> {
  const db = getDb()
  const { sidebar, ...rest } = input
  // Null puts the default back.
  const change = {
    ...rest,
    ...(sidebar !== undefined && { sidebar: sidebar === null ? Prisma.DbNull : normalizeSidebar(sidebar) }),
  }
  const [saved] = await db.$transaction([
    db.mailPreferences.upsert({ where: { userId }, create: { userId, ...change }, update: change, select }),
    // Turned off, nothing found in shipping mail stays behind.
    ...(change.parcels === false ? [db.mailShipment.deleteMany({ where: { userId } })] : []),
    ...(change.invoices === false ? [db.mailInvoice.deleteMany({ where: { userId } })] : []),
    // Turned off, nothing stays pinned to come back later.
    ...(change.pins === false ? [db.mailPin.deleteMany({ where: { userId } })] : []),
  ])
  return { ...saved, sidebar: saved.sidebar === null ? null : normalizeSidebar(saved.sidebar) }
}
