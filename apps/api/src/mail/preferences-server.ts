import { getDb } from "@evido/db"

export type MailPreferences = { summaries: boolean; codes: boolean; aiWriting: boolean; remoteImages: boolean }

const select = { summaries: true, codes: true, aiWriting: true, remoteImages: true } as const

/** Null until first saved, so the first device can bring along what it had chosen. */
export async function readPreferences(userId: string): Promise<MailPreferences | null> {
  return getDb().mailPreferences.findUnique({ where: { userId }, select })
}

export async function savePreferences(userId: string, change: Partial<MailPreferences>): Promise<MailPreferences> {
  return getDb().mailPreferences.upsert({
    where: { userId },
    create: { userId, ...change },
    update: change,
    select,
  })
}
