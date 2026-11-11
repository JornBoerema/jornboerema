import { randomUUID } from "node:crypto"
import { getDb, type MailAccount } from "@evido/db"
import { findShipmentInThread, looksLikeShipment, type FoundShipment } from "@evido/mail-core/shipments"
import type { MailShipmentView, MailThreadMessage } from "@evido/mail-core/types"
import { readConversation, threadLines, type Conversation } from "./threads-server"

/** How far back shipping mail is looked through: parcels older than this have arrived. */
const SCAN_DAYS = 30
/** A delivered parcel leaves the list after this long. */
const KEEP_DELIVERED_DAYS = 14
/** Raised when the reading improves, so shipping mail already read is read again. */
const READ_VERSION = 4
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
    readVersion: READ_VERSION,
    found: found !== null,
    carrier: found?.carrier ?? null,
    trackingCode: found?.trackingCode ?? null,
    trackingUrl: found?.trackingUrl ?? null,
    merchant: found?.merchant ?? null,
    orderNumber: found?.orderNumber ?? null,
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
    select: { accountId: true, threadId: true, messageId: true, readVersion: true, dismissed: true },
  })
  // Reported as wrong: never read again, whatever the version.
  const upToDate = new Set(
    known.filter((row) => row.readVersion >= READ_VERSION || row.dismissed).map((row) => `${row.accountId}:${row.threadId}:${row.messageId}`)
  )
  const toRead = [...newestByThread.entries()].filter(
    ([key, message]) => !upToDate.has(`${key}:${message.providerMessageId}`)
  )
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

type Row = Awaited<ReturnType<ReturnType<typeof getDb>["mailShipment"]["findMany"]>>[number]

/**
 * Mails about one delivery, however they name it: rows that share a tracking
 * code or an order number end up together, through any chain of them.
 */
function deliveries(rows: Row[]): Row[][] {
  const parent = rows.map((_, index) => index)
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])))
  const firstWith = new Map<string, number>()
  rows.forEach((row, index) => {
    for (const key of [row.trackingCode && `code:${row.trackingCode}`, row.orderNumber && `order:${row.orderNumber}`]) {
      if (!key) continue
      const other = firstWith.get(key)
      if (other === undefined) firstWith.set(key, index)
      else parent[root(index)] = root(other)
    }
  })
  const groups = new Map<number, Row[]>()
  rows.forEach((row, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), row]))
  return [...groups.values()]
}

/**
 * One line for a delivery, from its mails newest first: the newest names the
 * status, unless an earlier one already said it was delivered; any of them may
 * hold the link, the code or the shop. A carrier's own link wins over a shop's.
 */
function asLine(mails: Row[]): Row {
  const newest = mails[0]
  const first = <K extends keyof Row>(key: K) => mails.find((mail) => mail[key] !== null)?.[key] ?? null
  const delivered = mails.some((mail) => mail.status === "delivered") && newest.status !== "problem"
  const withCarrierLink = mails.find((mail) => mail.carrier && mail.trackingUrl)
  return {
    ...newest,
    carrier: first("carrier"),
    trackingCode: first("trackingCode"),
    trackingUrl: withCarrierLink?.trackingUrl ?? first("trackingUrl"),
    merchant: first("merchant"),
    orderNumber: first("orderNumber"),
    status: delivered ? "delivered" : (newest.status ?? first("status")),
  }
}

/** Parcels on their way, and delivered ones for two weeks, newest first, one line per delivery. */
export async function listShipments(userId: string): Promise<MailShipmentView[]> {
  const rows = await getDb().mailShipment.findMany({
    where: { userId, found: true, dismissed: false, receivedAt: { gte: daysAgo(SCAN_DAYS) } },
    orderBy: { receivedAt: "desc" },
  })
  const shown = deliveries(rows)
    .map(asLine)
    .filter((row) => !(row.status === "delivered" && row.receivedAt < daysAgo(KEEP_DELIVERED_DAYS)))
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
  // The conversation each line opens: its newest mail's.
  const threads = await threadLines(userId, shown)
  return shown.map((row) => ({ ...toView(row), thread: threads.get(`${row.accountId}:${row.threadId}`) }))
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
  if (kept?.dismissed) return null
  if (kept && newestSynced && kept.messageId === newestSynced.providerMessageId && kept.readVersion >= READ_VERSION)
    return kept.found ? toView(kept) : null

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
