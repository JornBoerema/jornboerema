import { getDb, Prisma } from "@evido/db"
import type {
  MailForward,
  MailOutgoing,
  MailReply,
  MailThreadAction,
  MailThreadDetail,
  MailThreadsPage,
  MailThreadView,
} from "@evido/mail-core/types"
import { ownedAccount, withAccessToken } from "./accounts-server"

export class InvalidThreadCursorError extends Error {}
export class MailMessageNotFoundError extends Error {}

const PAGE_SIZE = 50

function parseCursor(cursor: string) {
  const separator = cursor.indexOf("|")
  const receivedAt = new Date(cursor.slice(0, separator))
  const id = cursor.slice(separator + 1)
  if (separator < 1 || !id || Number.isNaN(receivedAt.getTime()))
    throw new InvalidThreadCursorError()
  return { receivedAt, id }
}

type ThreadRow = Omit<MailThreadView, "receivedAt"> & { receivedAt: Date }

/** Conversations newest first, across every mailbox or the one in `accountId`. */
export async function listThreads(
  userId: string,
  { accountId, cursor }: { accountId?: string; cursor?: string }
): Promise<MailThreadsPage> {
  const position = cursor ? parseCursor(cursor) : null
  const accountFilter = accountId ? Prisma.sql`AND account_id = ${accountId}` : Prisma.empty
  const after = position
    ? Prisma.sql`AND (received_at < ${position.receivedAt} OR (received_at = ${position.receivedAt} AND id < ${position.id}))`
    : Prisma.empty

  const rows = await getDb().$queryRaw<ThreadRow[]>`
    SELECT id,
      account_id AS "accountId",
      subject,
      snippet,
      from_name AS "fromName",
      from_email AS "fromEmail",
      received_at AS "receivedAt",
      all_read AS "isRead",
      any_starred AS "isStarred",
      any_attachment AS "hasAttachments",
      message_count::int AS "messageCount"
    FROM (
      SELECT *,
        row_number() OVER (conversation ORDER BY received_at DESC, id DESC) AS position,
        count(*) OVER conversation AS message_count,
        bool_and(is_read) OVER conversation AS all_read,
        bool_or(is_starred) OVER conversation AS any_starred,
        bool_or(has_attachments) OVER conversation AS any_attachment
      FROM mail_messages
      WHERE user_id = ${userId} ${accountFilter}
      WINDOW conversation AS (PARTITION BY account_id, coalesce(thread_id, id))
    ) grouped
    WHERE position = 1 ${after}
    ORDER BY received_at DESC, id DESC
    LIMIT ${PAGE_SIZE + 1}
  `
  const page = rows.slice(0, PAGE_SIZE)
  const last = page.at(-1)
  return {
    threads: page.map((row) => ({ ...row, receivedAt: row.receivedAt.toISOString() })),
    nextCursor: rows.length > PAGE_SIZE && last ? `${last.receivedAt.toISOString()}|${last.id}` : null,
  }
}

async function ownedMessage(userId: string, messageId: string) {
  const message = await getDb().mailMessage.findFirst({
    where: { id: messageId, userId },
    include: { account: true },
  })
  if (!message?.threadId) throw new MailMessageNotFoundError()
  return { ...message, threadId: message.threadId }
}

/** Reads a conversation live from the provider. Nothing from it is written to the database. */
export async function readThread(userId: string, messageId: string): Promise<MailThreadDetail> {
  const { account, threadId } = await ownedMessage(userId, messageId)
  const messages = await withAccessToken(account, (provider, token) =>
    provider.getThread(token, threadId)
  )
  return { messages }
}

/** Changes the mailbox first; the list only follows once the provider has accepted it. */
export async function actOnThread(userId: string, messageId: string, action: MailThreadAction) {
  const { account, accountId, threadId } = await ownedMessage(userId, messageId)
  const db = getDb()
  const where = { accountId, threadId }
  const rows = await db.mailMessage.findMany({ where, select: { providerMessageId: true } })
  await withAccessToken(account, (provider, token) =>
    provider.applyThreadAction(token, {
      threadId,
      messageIds: rows.map((row) => row.providerMessageId),
      action,
    })
  )
  if (action === "archive" || action === "trash") await db.mailMessage.deleteMany({ where })
  else await db.mailMessage.updateMany({ where, data: { isRead: action === "read" } })
}

const sender = (account: { email: string; displayName: string | null }) => ({
  name: account.displayName,
  email: account.email,
})

export async function replyToThread(userId: string, messageId: string, reply: MailReply) {
  const { account, threadId } = await ownedMessage(userId, messageId)
  await withAccessToken(account, (provider, token) =>
    provider.reply(token, { ...reply, threadId, from: sender(account) })
  )
}

export async function forwardThread(userId: string, messageId: string, forward: MailForward) {
  const { account } = await ownedMessage(userId, messageId)
  await withAccessToken(account, (provider, token) =>
    provider.forward(token, { ...forward, from: sender(account) })
  )
}

export async function readAttachment(
  userId: string,
  messageId: string,
  input: { messageId: string; attachmentId: string }
) {
  const { account } = await ownedMessage(userId, messageId)
  return withAccessToken(account, (provider, token) => provider.getAttachment(token, input))
}

export async function sendMessage(userId: string, accountId: string, outgoing: MailOutgoing) {
  const account = await ownedAccount(userId, accountId)
  await withAccessToken(account, (provider, token) =>
    provider.send(token, { ...outgoing, from: sender(account) })
  )
}
