import { randomUUID } from "node:crypto"
import { getDb, type MailAccount } from "@evido/db"
import { findInvoiceInThread, looksLikeInvoice, type FoundInvoice } from "@evido/mail-core/invoices"
import type { MailInvoiceView, MailThreadMessage } from "@evido/mail-core/types"
import { readConversation, threadLines, type Conversation } from "./threads-server"

/** How far back mail about money is looked through. */
const SCAN_DAYS = 120
/** Raised when the reading improves, so mail already read is read again. */
const READ_VERSION = 5
/** Reading mail takes a provider call each; the rest is picked up next time. */
const SCAN_BUDGET_MS = 8_000

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

type Row = Awaited<ReturnType<ReturnType<typeof getDb>["mailInvoice"]["findMany"]>>[number]

const toView = (row: Row): MailInvoiceView => ({
  vendor: row.vendor,
  amountCents: row.amountCents,
  currency: row.currency,
  dueDate: row.dueDate,
  invoiceNumber: row.invoiceNumber,
  payUrl: row.payUrl,
  status: (row.status ?? "due") as MailInvoiceView["status"],
  overdue: row.overdue,
  subject: row.subject,
  receivedAt: row.receivedAt.toISOString(),
})

const invoiceIn = (messages: MailThreadMessage[]) =>
  findInvoiceInThread(
    messages.map((message) => ({
      subject: message.subject,
      fromName: message.from?.name ?? null,
      fromEmail: message.from?.email ?? null,
      html: message.html,
      text: message.text,
      hasAttachments: message.attachments.length > 0,
    }))
  )

async function save(
  account: Pick<MailAccount, "id" | "userId">,
  threadId: string,
  newest: { id: string; subject: string; receivedAt: Date },
  found: FoundInvoice | null
) {
  const data = {
    messageId: newest.id,
    readVersion: READ_VERSION,
    found: found !== null,
    vendor: found?.vendor ?? null,
    amountCents: found?.amountCents ?? null,
    currency: found?.currency ?? null,
    dueDate: found?.dueDate ?? null,
    invoiceNumber: found?.invoiceNumber ?? null,
    payUrl: found?.payUrl ?? null,
    status: found?.status ?? null,
    overdue: found?.overdue ?? false,
    subject: newest.subject,
    receivedAt: newest.receivedAt,
  }
  return getDb().mailInvoice.upsert({
    where: { accountId_threadId: { accountId: account.id, threadId } },
    create: { id: randomUUID(), userId: account.userId, accountId: account.id, threadId, ...data },
    update: data,
  })
}

/** Reads the mail about money of the last months that hasn't been read yet, for as long as the budget allows. */
export async function scanInvoices(userId: string, budgetMs = SCAN_BUDGET_MS) {
  const db = getDb()
  const deadline = Date.now() + budgetMs
  const recent = await db.mailMessage.findMany({
    where: {
      userId,
      receivedAt: { gte: daysAgo(SCAN_DAYS) },
      folder: { in: ["inbox", "archive"] },
      threadId: { not: null },
    },
    select: { accountId: true, threadId: true, providerMessageId: true, subject: true, fromEmail: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
  })
  const newestByThread = new Map<string, (typeof recent)[number]>()
  for (const message of recent) {
    const key = `${message.accountId}:${message.threadId}`
    if (!newestByThread.has(key) && looksLikeInvoice(message)) newestByThread.set(key, message)
  }
  if (newestByThread.size === 0) return { done: true }

  const known = await db.mailInvoice.findMany({
    where: { userId, threadId: { in: [...newestByThread.values()].map((message) => message.threadId!) } },
    select: { accountId: true, threadId: true, messageId: true, readVersion: true, dismissed: true },
  })
  // Reported as wrong: never read again, whatever the version.
  const upToDate = new Set(
    known.filter((row) => row.readVersion >= READ_VERSION || row.dismissed).map((row) => `${row.accountId}:${row.threadId}:${row.messageId}`)
  )
  const toRead = [...newestByThread.entries()].filter(([key, message]) => !upToDate.has(`${key}:${message.providerMessageId}`))
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
      await save(
        account,
        message.threadId!,
        { id: message.providerMessageId, subject: message.subject, receivedAt: message.receivedAt },
        invoiceIn(messages)
      )
    } catch (error) {
      console.error("Invoice scan failed for a conversation", error)
    }
  }
  return { done: true }
}

/**
 * Invoices newest first. The invoice, its reminder and its receipt in separate
 * conversations become one line when they name the same vendor and number:
 * the newest says where it stands, unless an earlier one already said paid.
 */
export async function listInvoices(userId: string): Promise<MailInvoiceView[]> {
  const rows = await getDb().mailInvoice.findMany({
    where: { userId, found: true, dismissed: false, receivedAt: { gte: daysAgo(SCAN_DAYS) } },
    orderBy: { receivedAt: "desc" },
  })
  const lines = new Map<string, Row>()
  for (const row of rows) {
    // One invoice number is one invoice, whichever name its mails go by; repeated
    // notices of one failed or late payment are one line too.
    const key = row.invoiceNumber
      ? `number:${row.invoiceNumber}`
      : (row.status === "failed" || row.overdue) && row.vendor
        ? `${row.status}:${row.overdue}:${row.vendor.toLowerCase()}:${row.amountCents ?? ""}`
        : `${row.accountId}:${row.threadId}`
    const line = lines.get(key)
    if (!line) {
      lines.set(key, { ...row })
      continue
    }
    line.amountCents ??= row.amountCents
    line.currency ??= row.currency
    line.dueDate ??= row.dueDate
    line.payUrl ??= row.payUrl
    if (row.status === "paid" && line.status !== "failed") line.status = "paid"
  }
  const shown = [...lines.values()]
  const threads = await threadLines(userId, shown)
  return shown.map((row) => ({ ...toView(row), thread: threads.get(`${row.accountId}:${row.threadId}`) }))
}

/** What an open conversation says about money, for the card above it, or null. */
export async function invoiceForConversation(conversation: Conversation): Promise<MailInvoiceView | null> {
  const { account, threadId } = conversation
  const db = getDb()
  const newestSynced = await db.mailMessage.findFirst({
    where: { accountId: account.id, threadId },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { providerMessageId: true },
  })
  const kept = await db.mailInvoice.findUnique({ where: { accountId_threadId: { accountId: account.id, threadId } } })
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
    invoiceIn(messages)
  )
  return saved.found ? toView(saved) : null
}
