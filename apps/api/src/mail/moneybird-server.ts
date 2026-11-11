import { randomUUID } from "node:crypto"
import { getDb } from "@evido/db"
import { attachmentKey, MONEYBIRD_MAX_BYTES, type MoneybirdExportView, type MoneybirdThreadView } from "@evido/mail-core/connections"
import { AdministrationNotFoundError, moneybirdConnection, withMoneybird } from "../connections/connections-server"
import { administrationUrl, listAdministrations, uploadToInbox } from "../connections/moneybird"
import { attachmentInConversation, type Conversation } from "./threads-server"

export class FileTooLargeForMoneybirdError extends Error {}
export class NoAdministrationChosenError extends Error {}

type Row = Awaited<ReturnType<ReturnType<typeof getDb>["moneybirdExport"]["findMany"]>>[number]

const toView = (row: Row): MoneybirdExportView => ({
  messageId: row.messageId,
  attachmentName: row.attachmentName,
  attachmentKey: row.attachmentKey,
  administrationId: row.administrationId,
  administrationName: row.administrationName,
  url: administrationUrl(row.administrationId),
  createdAt: row.createdAt.toISOString(),
})

const domainOf = (email: string | null | undefined) => email?.split("@")[1]?.toLowerCase() || null

/** The sender of a synced message, so the next mail from them goes to the same books. */
async function senderDomain(accountId: string, messageId: string) {
  const message = await getDb().mailMessage.findFirst({
    where: { accountId, providerMessageId: messageId },
    select: { fromEmail: true },
  })
  return domainOf(message?.fromEmail)
}

/** What of this conversation already went to Moneybird, and where its sender's mail went before. */
export async function moneybirdForConversation(userId: string, { account, threadId }: Conversation): Promise<MoneybirdThreadView> {
  const db = getDb()
  const rows = await db.moneybirdExport.findMany({
    where: { accountId: account.id, threadId },
    orderBy: { createdAt: "desc" },
  })
  const newest = await db.mailMessage.findFirst({
    where: { accountId: account.id, threadId },
    orderBy: { receivedAt: "desc" },
    select: { fromEmail: true },
  })
  const domain = domainOf(newest?.fromEmail)
  const previous = domain
    ? await db.moneybirdExport.findFirst({
        where: { userId, senderDomain: domain },
        orderBy: { createdAt: "desc" },
        select: { administrationId: true },
      })
    : null
  return { exports: rows.map(toView), suggestedAdministrationId: previous?.administrationId ?? null }
}

export type MoneybirdSend = {
  messageId: string
  attachmentId: string
  name: string
  contentType: string
  size: number
  /** Omitted: the default administration. */
  administrationId?: string
  subject?: string
}

/**
 * Hands one attachment to Moneybird's inbox, where it is read and booked.
 * The file goes straight from the mailbox to Moneybird; nothing is kept here
 * but the fact that it went, and where.
 */
export async function sendToMoneybird(userId: string, conversation: Conversation, input: MoneybirdSend): Promise<MoneybirdExportView> {
  const db = getDb()
  const connection = await moneybirdConnection(userId)
  const administrationId = input.administrationId ?? connection.defaultTargetId
  if (!administrationId) throw new NoAdministrationChosenError()
  const key = attachmentKey(input)
  const { account, threadId } = conversation
  const already = await db.moneybirdExport.findUnique({
    where: {
      accountId_messageId_attachmentKey_administrationId: { accountId: account.id, messageId: input.messageId, attachmentKey: key, administrationId },
    },
  })
  if (already) return toView(already)

  const administration = (await withMoneybird(connection, listAdministrations)).find((item) => item.id === administrationId)
  if (!administration) throw new AdministrationNotFoundError()
  if (input.size > MONEYBIRD_MAX_BYTES) throw new FileTooLargeForMoneybirdError()
  const bytes = await attachmentInConversation(conversation, input)
  if (bytes.byteLength > MONEYBIRD_MAX_BYTES) throw new FileTooLargeForMoneybirdError()

  const documentId = await withMoneybird(connection, (token) =>
    uploadToInbox(token, administration.id, {
      name: input.name,
      contentType: input.contentType,
      bytes,
      reference: input.subject?.trim() || input.name,
    })
  )
  const row = await db.moneybirdExport.upsert({
    where: {
      accountId_messageId_attachmentKey_administrationId: { accountId: account.id, messageId: input.messageId, attachmentKey: key, administrationId },
    },
    create: {
      id: randomUUID(),
      userId,
      accountId: account.id,
      threadId,
      messageId: input.messageId,
      attachmentKey: key,
      attachmentName: input.name,
      senderDomain: await senderDomain(account.id, input.messageId),
      administrationId: administration.id,
      administrationName: administration.name,
      documentId,
    },
    update: {},
  })
  return toView(row)
}
