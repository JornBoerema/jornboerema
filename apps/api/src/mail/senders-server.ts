import { getDb, Prisma } from "@even/db"
import type { MailSenderView } from "@even/mail-core/types"
import { notifyMailChanged } from "../lib/realtime"
import { actOnConversation, threadLines } from "./threads-server"
import { visibleAccounts, type MailViewer } from "./accounts-server"

/** The senders shown: the busiest, as far as anyone tidies up in one go. */
const MAX_SENDERS = 150
/** Within the function limit, with room for the answer; the rest is the next round. */
const BUDGET_MS = 20_000
const CONCURRENCY = 4

type SenderRow = Omit<MailSenderView, "latest" | "thread"> & { latest: Date; accountId: string; threadId: string | null }

/**
 * Who fills the inbox: everyone with at least two messages there, busiest
 * first, from the synced metadata alone. Mail from the user's own mailboxes
 * isn't tidied away here.
 */
export async function listSenders(viewer: MailViewer, accountId?: string): Promise<MailSenderView[]> {
  const db = getDb()
  const visible = await visibleAccounts(viewer)
  const own = visible.map((account) => account.email.toLowerCase())
  const accountIds = visible.map((account) => account.id).filter((id) => !accountId || id === accountId)
  if (accountIds.length === 0) return []
  const ownFilter = own.length ? Prisma.sql`AND lower(from_email) NOT IN (${Prisma.join(own)})` : Prisma.empty
  const rows = await db.$queryRaw<SenderRow[]>`
    SELECT lower(from_email) AS email,
      (array_agg(from_name ORDER BY received_at DESC) FILTER (WHERE from_name IS NOT NULL))[1] AS name,
      count(*)::int AS messages,
      (count(*) FILTER (WHERE NOT is_read))::int AS unread,
      count(DISTINCT coalesce(thread_id, id))::int AS conversations,
      max(received_at) AS latest,
      (array_agg(provider_message_id ORDER BY received_at DESC))[1] AS "providerMessageId",
      (array_agg(account_id ORDER BY received_at DESC))[1] AS "accountId",
      (array_agg(thread_id ORDER BY received_at DESC))[1] AS "threadId"
    FROM mail_messages
    WHERE account_id IN (${Prisma.join(accountIds)}) AND folder = 'inbox' AND from_email IS NOT NULL ${ownFilter}
    GROUP BY lower(from_email)
    HAVING count(*) >= 2
    ORDER BY count(*) DESC, max(received_at) DESC
    LIMIT ${MAX_SENDERS}
  `
  const threads = await threadLines(
    viewer,
    rows.flatMap((row) => (row.threadId ? [{ accountId: row.accountId, threadId: row.threadId }] : []))
  )
  return rows.map(({ accountId: id, threadId, ...row }) => ({
    ...row,
    latest: row.latest.toISOString(),
    thread: (threadId && threads.get(`${id}:${threadId}`)) || null,
  }))
}

export type SenderAction = "archive" | "read" | "trash"

/** How many of their conversations the sender pane lists. */
const PANE_THREADS = 50

/** Their conversations in the inbox, newest first, as list lines. */
export async function senderConversations(viewer: MailViewer, email: string, accountId?: string) {
  const db = getDb()
  const visible = (await visibleAccounts(viewer)).map((account) => account.id)
  const messages = await db.mailMessage.findMany({
    where: {
      accountId: { in: accountId ? visible.filter((id) => id === accountId) : visible },
      folder: "inbox",
      fromEmail: { equals: email, mode: "insensitive" },
      threadId: { not: null },
    },
    select: { accountId: true, threadId: true },
    orderBy: { receivedAt: "desc" },
    take: PANE_THREADS * 3,
  })
  const threads = [...new Map(messages.map((row) => [`${row.accountId}:${row.threadId}`, row])).values()].slice(
    0,
    PANE_THREADS
  )
  const lines = await threadLines(
    viewer,
    threads.map((row) => ({ accountId: row.accountId, threadId: row.threadId! }))
  )
  return threads.flatMap((row) => lines.get(`${row.accountId}:${row.threadId}`) ?? [])
}

/**
 * Archives, trashes, or marks read, every inbox conversation with mail from one sender,
 * a round at a time: as many as fit in the time budget, a few in parallel. The
 * database follows each one, so the next round picks up what is left.
 */
export async function actOnSender(
  viewer: MailViewer,
  email: string,
  action: SenderAction,
  accountId?: string
): Promise<{ handled: number; remaining: number }> {
  const db = getDb()
  const deadline = Date.now() + BUDGET_MS
  const active = await visibleAccounts(viewer, { active: true })
  const accounts = new Map(active.map((account) => [account.id, account]))
  const messages = await db.mailMessage.findMany({
    where: {
      accountId: { in: [...accounts.keys()].filter((id) => !accountId || id === accountId) },
      folder: "inbox",
      fromEmail: { equals: email, mode: "insensitive" },
      threadId: { not: null },
      ...(action === "read" && { isRead: false }),
    },
    select: { accountId: true, threadId: true },
    orderBy: { receivedAt: "desc" },
  })
  const threads = [...new Map(messages.map((row) => [`${row.accountId}:${row.threadId}`, row])).values()]

  let handled = 0
  for (let start = 0; start < threads.length && Date.now() < deadline; start += CONCURRENCY) {
    const round = threads.slice(start, start + CONCURRENCY)
    const results = await Promise.allSettled(
      round.map(({ accountId: id, threadId }) => {
        const account = accounts.get(id)
        return account ? actOnConversation({ account, threadId: threadId! }, action) : Promise.resolve()
      })
    )
    handled += results.filter((result) => result.status === "fulfilled").length
    for (const result of results)
      if (result.status === "rejected") console.error("Tidying a sender's conversation failed", result.reason)
  }
  if (handled > 0) await notifyMailChanged(viewer.userId).catch(() => undefined)
  return { handled, remaining: Math.max(0, threads.length - handled) }
}
