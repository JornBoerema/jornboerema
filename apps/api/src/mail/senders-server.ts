import { getDb, Prisma } from "@evido/db"
import type { MailSenderView } from "@evido/mail-core/types"
import { notifyMailChanged } from "../lib/realtime"
import { actOnConversation, threadLines } from "./threads-server"

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
export async function listSenders(userId: string, accountId?: string): Promise<MailSenderView[]> {
  const db = getDb()
  const own = (await db.mailAccount.findMany({ where: { userId }, select: { email: true } })).map((account) =>
    account.email.toLowerCase()
  )
  const accountFilter = accountId ? Prisma.sql`AND account_id = ${accountId}` : Prisma.empty
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
    WHERE user_id = ${userId} AND folder = 'inbox' AND from_email IS NOT NULL ${accountFilter} ${ownFilter}
    GROUP BY lower(from_email)
    HAVING count(*) >= 2
    ORDER BY count(*) DESC, max(received_at) DESC
    LIMIT ${MAX_SENDERS}
  `
  const threads = await threadLines(
    userId,
    rows.flatMap((row) => (row.threadId ? [{ accountId: row.accountId, threadId: row.threadId }] : []))
  )
  return rows.map(({ accountId: id, threadId, ...row }) => ({
    ...row,
    latest: row.latest.toISOString(),
    thread: (threadId && threads.get(`${id}:${threadId}`)) || null,
  }))
}

export type SenderAction = "archive" | "read"

/**
 * Archives, or marks read, every inbox conversation with mail from one sender,
 * a round at a time: as many as fit in the time budget, a few in parallel. The
 * database follows each one, so the next round picks up what is left.
 */
export async function actOnSender(
  userId: string,
  email: string,
  action: SenderAction,
  accountId?: string
): Promise<{ handled: number; remaining: number }> {
  const db = getDb()
  const deadline = Date.now() + BUDGET_MS
  const messages = await db.mailMessage.findMany({
    where: {
      userId,
      folder: "inbox",
      fromEmail: { equals: email, mode: "insensitive" },
      threadId: { not: null },
      ...(action === "read" && { isRead: false }),
      ...(accountId && { accountId }),
    },
    select: { accountId: true, threadId: true },
    orderBy: { receivedAt: "desc" },
  })
  const threads = [...new Map(messages.map((row) => [`${row.accountId}:${row.threadId}`, row])).values()]
  const accounts = new Map(
    (await db.mailAccount.findMany({ where: { userId, status: "active" } })).map((account) => [account.id, account])
  )

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
  if (handled > 0) await notifyMailChanged(userId).catch(() => undefined)
  return { handled, remaining: Math.max(0, threads.length - handled) }
}
