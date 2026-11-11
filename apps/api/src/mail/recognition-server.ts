import { randomUUID } from "node:crypto"
import { getDb, Prisma } from "@evido/db"
import type { Conversation } from "./threads-server"

export const RECOGNITION_KINDS = ["parcel", "invoice"] as const
export const REPORT_REASONS = ["not_one", "amount", "status", "other"] as const

/**
 * A user saying a parcel or invoice was read wrongly: it leaves their list and
 * isn't read again, and the report keeps what is needed to improve the reading,
 * the subject, the sender's domain and what was found, never the mail.
 */
export async function reportRecognition(
  userId: string,
  { account, threadId }: Conversation,
  kind: (typeof RECOGNITION_KINDS)[number],
  reason: (typeof REPORT_REASONS)[number]
) {
  const db = getDb()
  const where = { accountId_threadId: { accountId: account.id, threadId } }
  const row =
    kind === "parcel" ? await db.mailShipment.findUnique({ where }) : await db.mailInvoice.findUnique({ where })
  if (!row) return { reported: false }
  const newest = await db.mailMessage.findFirst({
    where: { accountId: account.id, threadId },
    orderBy: { receivedAt: "desc" },
    select: { fromEmail: true },
  })
  const { id: _id, userId: _user, accountId: _account, threadId: _thread, messageId: _message, ...found } = row
  await db.$transaction([
    kind === "parcel"
      ? db.mailShipment.update({ where, data: { dismissed: true } })
      : db.mailInvoice.update({ where, data: { dismissed: true } }),
    db.mailRecognitionReport.create({
      data: {
        id: randomUUID(),
        userId,
        kind,
        reason,
        subject: row.subject,
        fromDomain: newest?.fromEmail?.split("@")[1]?.toLowerCase() ?? null,
        found: JSON.parse(JSON.stringify(found)) as Prisma.InputJsonValue,
      },
    }),
  ])
  return { reported: true }
}
