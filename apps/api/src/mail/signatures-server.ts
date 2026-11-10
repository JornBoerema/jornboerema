import { randomUUID } from "node:crypto"
import { getDb } from "@evido/db"
import { MAX_SIGNATURES, type MailSignature } from "@evido/mail-core/types"
import { MailSignatureNotFoundError } from "./accounts-server"

export class TooManySignaturesError extends Error {}

const select = { id: true, name: true, html: true } as const

export async function listSignatures(userId: string): Promise<MailSignature[]> {
  return getDb().mailSignature.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select })
}

export async function createSignature(userId: string, input: { name: string; html: string }) {
  const db = getDb()
  if ((await db.mailSignature.count({ where: { userId } })) >= MAX_SIGNATURES) throw new TooManySignaturesError()
  return db.mailSignature.create({ data: { id: randomUUID(), userId, ...input }, select })
}

export async function updateSignature(userId: string, id: string, input: { name?: string; html?: string }) {
  const { count } = await getDb().mailSignature.updateMany({ where: { id, userId }, data: input })
  if (count === 0) throw new MailSignatureNotFoundError()
}

/** Mailboxes that used it fall back to no signature. */
export async function deleteSignature(userId: string, id: string) {
  const { count } = await getDb().mailSignature.deleteMany({ where: { id, userId } })
  if (count === 0) throw new MailSignatureNotFoundError()
}
