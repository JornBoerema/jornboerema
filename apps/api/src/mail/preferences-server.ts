import { getDb } from "@evido/db"

export type MailPreferences = {
  summaries: boolean
  codes: boolean
  aiWriting: boolean
  remoteImages: boolean
  parcels: boolean
}

const select = { summaries: true, codes: true, aiWriting: true, remoteImages: true, parcels: true } as const

/** Null until first saved, so the first device can bring along what it had chosen. */
export async function readPreferences(userId: string): Promise<MailPreferences | null> {
  return getDb().mailPreferences.findUnique({ where: { userId }, select })
}

/** Whether Parcels is on: it is unless turned off. */
export async function parcelsEnabled(userId: string) {
  return (await readPreferences(userId))?.parcels ?? true
}

export async function savePreferences(userId: string, change: Partial<MailPreferences>): Promise<MailPreferences> {
  const db = getDb()
  const [saved] = await db.$transaction([
    db.mailPreferences.upsert({ where: { userId }, create: { userId, ...change }, update: change, select }),
    // Turned off, nothing found in shipping mail stays behind.
    ...(change.parcels === false ? [db.mailShipment.deleteMany({ where: { userId } })] : []),
  ])
  return saved
}
