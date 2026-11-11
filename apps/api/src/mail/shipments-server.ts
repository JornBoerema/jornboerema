import { randomUUID } from "node:crypto"
import { getDb, type MailAccount } from "@evido/db"
import { findShipmentInThread, looksLikeShipment, type FoundShipment } from "@evido/mail-core/shipments"
import type { MailShipmentView, MailThreadMessage, MailThreadView } from "@evido/mail-core/types"
import { readConversation, type Conversation } from "./threads-server"

/** How far back shipping mail is looked through: parcels older than this have arrived. */
const SCAN_DAYS = 30
/** A delivered parcel leaves the list after this long. */
const KEEP_DELIVERED_DAYS = 14
/** Reading mail takes a provider call each; the rest is picked up next time. */
const SCAN_BUDGET_MS = 8_000

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

type ShipmentRow = {
  found: boolean
  carrier: string | null
  trackingCode: string | null
  trackingUrl: string | null
  merchant: string | null
  status: string | null
  subject: string
  receivedAt: Date
}

const toView = (row: ShipmentRow): MailShipmentView => ({
  carrier: row.carrier as MailShipmentView["carrier"],
  trackingCode: row.trackingCode,
  trackingUrl: row.trackingUrl,
  merchant: row.merchant,
  status: row.status as MailShipmentView["status"],
  subject: row.subject,
  receivedAt: row.receivedAt.toISOString(),
})

/** Keeps what was found in a conversation, or that nothing was, until it grows. */
async function save(
  account: Pick<MailAccount, "id" | "userId">,
  threadId: string,
  newest: { id: string; subject: string; receivedAt: Date },
  found: FoundShipment | null
) {
  const data = {
    messageId: newest.id,
    found: found !== null,
    carrier: found?.carrier ?? null,
    trackingCode: found?.trackingCode ?? null,
    trackingUrl: found?.trackingUrl ?? null,
    merchant: found?.merchant ?? null,
    status: found?.status ?? null,
    subject: newest.subject,
    receivedAt: newest.receivedAt,
  }
  return getDb().mailShipment.upsert({
    where: { accountId_threadId: { accountId: account.id, threadId } },
    create: { id: randomUUID(), userId: account.userId, accountId: account.id, threadId, ...data },
    update: data,
  })
}

const shipmentIn = (messages: MailThreadMessage[]) =>
  findShipmentInThread(
    messages.map((message) => ({
      subject: message.subject,
      fromName: message.from?.name ?? null,
      fromEmail: message.from?.email ?? null,
      html: message.html,
      text: message.text,
    }))
  )

/**
 * Reads the shipping mail of the last month that hasn't been read yet, or has
 * grown since, for as long as the budget allows. Only the found fields are kept.
 */
export async function scanShipments(userId: string, budgetMs = SCAN_BUDGET_MS) {
  const db = getDb()
  const deadline = Date.now() + budgetMs
  const recent = await db.mailMessage.findMany({
    where: { userId, receivedAt: { gte: daysAgo(SCAN_DAYS) }, folder: { in: ["inbox", "archive"] }, threadId: { not: null } },
    select: { accountId: true, threadId: true, providerMessageId: true, subject: true, fromEmail: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
  })
  // The newest message of each conversation that might be about a parcel.
  const newestByThread = new Map<string, (typeof recent)[number]>()
  for (const message of recent) {
    const key = `${message.accountId}:${message.threadId}`
    if (!newestByThread.has(key) && looksLikeShipment(message)) newestByThread.set(key, message)
  }
  if (newestByThread.size === 0) return { done: true }

  const known = await db.mailShipment.findMany({
    where: { userId, threadId: { in: [...newestByThread.values()].map((message) => message.threadId!) } },
    select: { accountId: true, threadId: true, messageId: true },
  })
  const readUpTo = new Map(known.map((row) => [`${row.accountId}:${row.threadId}`, row.messageId]))
  const toRead = [...newestByThread.entries()].filter(([key, message]) => readUpTo.get(key) !== message.providerMessageId)
  if (toRead.length === 0) return { done: true }

  const accounts = new Map(
    (await db.mailAccount.findMany({ where: { userId, status: "active" } })).map((account) => [account.id, account])
  )
  for (const [, message] of toRead) {
    if (Date.now() > deadline) return { done: false }
    const account = accounts.get(message.accountId)
    if (!account) continue
    try {
      const { messages } = await readConversation({ account, threadId: message.threadId! })
      await save(account, message.threadId!, { id: message.providerMessageId, subject: message.subject, receivedAt: message.receivedAt }, shipmentIn(messages))
    } catch (error) {
      // One unreadable conversation shouldn't hold up the others; it is tried again next time.
      console.error("Shipment scan failed for a conversation", error)
    }
  }
  return { done: true }
}

/**
 * Parcels on their way, and delivered ones for two weeks, newest first. Mails
 * about one tracking code become one line: the newest says where it is, any of
 * them may hold the link, the code or the shop.
 */
export async function listShipments(userId: string): Promise<MailShipmentView[]> {
  const rows = await getDb().mailShipment.findMany({
    where: { userId, found: true, receivedAt: { gte: daysAgo(SCAN_DAYS) } },
    orderBy: { receivedAt: "desc" },
  })
  const lines = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    // The shop's mail and the carrier's name the same code; together they are one parcel.
    const key = row.trackingCode ? `code:${row.trackingCode}` : `${row.accountId}:${row.threadId}`
    const line = lines.get(key)
    if (!line) {
      lines.set(key, { ...row })
      continue
    }
    line.carrier ??= row.carrier
    line.trackingUrl ??= row.trackingUrl
    line.merchant ??= row.merchant
    line.status ??= row.status
  }
  const shown = [...lines.values()].filter(
    (row) => !(row.status === "delivered" && row.receivedAt < daysAgo(KEEP_DELIVERED_DAYS))
  )
  // The conversation each line opens, as the list shows conversations.
  const threads = await threadViews(userId, shown)
  return shown.map((row) => ({ ...toView(row), thread: threads.get(`${row.accountId}:${row.threadId}`) }))
}

/** The newest synced message of each conversation, shaped as a list line. */
async function threadViews(userId: string, rows: { accountId: string; threadId: string }[]) {
  const views = new Map<string, MailThreadView>()
  if (rows.length === 0) return views
  const messages = await getDb().mailMessage.findMany({
    where: { userId, OR: rows.map(({ accountId, threadId }) => ({ accountId, threadId })) },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  })
  for (const message of messages) {
    const key = `${message.accountId}:${message.threadId}`
    const view = views.get(key)
    if (view) {
      view.messageCount += 1
      view.isRead &&= message.isRead
      continue
    }
    views.set(key, {
      id: message.id,
      accountId: message.accountId,
      subject: message.subject,
      snippet: message.snippet,
      fromName: message.fromName,
      fromEmail: message.fromEmail,
      receivedAt: message.receivedAt.toISOString(),
      isRead: message.isRead,
      isStarred: message.isStarred,
      hasAttachments: message.hasAttachments,
      messageCount: 1,
    })
  }
  return views
}

/**
 * The parcel an open conversation is about, for the card above it, or null.
 * Kept per conversation, so it is read again only when it has grown.
 */
export async function shipmentForConversation(conversation: Conversation): Promise<MailShipmentView | null> {
  const { account, threadId } = conversation
  const db = getDb()
  const newestSynced = await db.mailMessage.findFirst({
    where: { accountId: account.id, threadId },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { providerMessageId: true },
  })
  const kept = await db.mailShipment.findUnique({ where: { accountId_threadId: { accountId: account.id, threadId } } })
  if (kept && newestSynced && kept.messageId === newestSynced.providerMessageId) return kept.found ? toView(kept) : null

  const { messages } = await readConversation(conversation, { includeHidden: conversation.hidden })
  const newest = messages.at(-1)
  if (!newest) return null
  const saved = await save(
    account,
    threadId,
    { id: newest.id, subject: newest.subject, receivedAt: new Date(newest.receivedAt) },
    shipmentIn(messages)
  )
  return saved.found ? toView(saved) : null
}
