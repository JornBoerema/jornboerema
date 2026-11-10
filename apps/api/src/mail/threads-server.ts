import { getDb, Prisma, type MailAccount } from "@evido/db"
import {
  MAX_SEARCH_HITS,
  rankSearchHits,
  searchWords,
  type MailForward,
  type MailOutgoing,
  type MailReply,
  type MailSearchHit,
  type MailThreadAction,
  type MailThreadDetail,
  type MailThreadsPage,
  type MailThreadView,
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

type Conversation = { account: MailAccount; threadId: string }

async function ownedMessage(userId: string, messageId: string): Promise<Conversation> {
  const message = await getDb().mailMessage.findFirst({
    where: { id: messageId, userId },
    include: { account: true },
  })
  if (!message?.threadId) throw new MailMessageNotFoundError()
  return { account: message.account, threadId: message.threadId }
}

/** A conversation by its provider id, such as one search found outside the synced inbox. */
export async function ownedConversation(userId: string, accountId: string, threadId: string): Promise<Conversation> {
  return { account: await ownedAccount(userId, accountId), threadId }
}

/** Reads a conversation live from the provider. Nothing from it is written to the database. */
export async function readConversation({ account, threadId }: Conversation): Promise<MailThreadDetail> {
  const messages = await withAccessToken(account, (provider, token) => provider.getThread(token, threadId))
  return { messages }
}

/** Changes the mailbox first; the list only follows once the provider has accepted it. */
export async function actOnConversation({ account, threadId }: Conversation, action: MailThreadAction) {
  const db = getDb()
  const where = { accountId: account.id, threadId }
  const rows = await db.mailMessage.findMany({ where, select: { providerMessageId: true } })
  await withAccessToken(account, async (provider, token) => {
    // Not in the synced inbox, like an older or sent conversation: ask the provider.
    const messageIds =
      rows.length > 0
        ? rows.map((row) => row.providerMessageId)
        : (await provider.getThread(token, threadId)).map((message) => message.id)
    await provider.applyThreadAction(token, { threadId, messageIds, action })
  })
  if (action === "archive" || action === "trash") await db.mailMessage.deleteMany({ where })
  else await db.mailMessage.updateMany({ where, data: { isRead: action === "read" } })
}

const sender = (account: { email: string; displayName: string | null }) => ({
  name: account.displayName,
  email: account.email,
})

export async function replyInConversation({ account, threadId }: Conversation, reply: MailReply) {
  await withAccessToken(account, (provider, token) =>
    provider.reply(token, { ...reply, threadId, from: sender(account) })
  )
}

export async function forwardFromConversation({ account }: Conversation, forward: MailForward) {
  await withAccessToken(account, (provider, token) =>
    provider.forward(token, { ...forward, from: sender(account) })
  )
}

export async function attachmentInConversation(
  { account }: Conversation,
  input: { messageId: string; attachmentId: string }
) {
  return withAccessToken(account, (provider, token) => provider.getAttachment(token, input))
}

export const readThread = async (userId: string, messageId: string) =>
  readConversation(await ownedMessage(userId, messageId))

export const actOnThread = async (userId: string, messageId: string, action: MailThreadAction) =>
  actOnConversation(await ownedMessage(userId, messageId), action)

export const replyToThread = async (userId: string, messageId: string, reply: MailReply) =>
  replyInConversation(await ownedMessage(userId, messageId), reply)

export const forwardThread = async (userId: string, messageId: string, forward: MailForward) =>
  forwardFromConversation(await ownedMessage(userId, messageId), forward)

export const readAttachment = async (
  userId: string,
  messageId: string,
  input: { messageId: string; attachmentId: string }
) => attachmentInConversation(await ownedMessage(userId, messageId), input)

export async function sendMessage(userId: string, accountId: string, outgoing: MailOutgoing) {
  const account = await ownedAccount(userId, accountId)
  await withAccessToken(account, (provider, token) =>
    provider.send(token, { ...outgoing, from: sender(account) })
  )
}

/** Searches every active mailbox live. A mailbox that fails is reported, not fatal. */
export async function searchMail(userId: string, query: string) {
  const accounts = await getDb().mailAccount.findMany({ where: { userId, status: "active" } })
  const results = await Promise.allSettled(
    accounts.map((account) =>
      withAccessToken(account, (provider, token) => provider.search(token, query)).then((hits) =>
        hits.map((hit): MailSearchHit => ({ ...hit, accountId: account.id }))
      )
    )
  )
  for (const result of results)
    if (result.status === "rejected")
      console.error("Mail search failed", result.reason instanceof Error ? result.reason.message : "unknown")
  const hits = rankSearchHits(
    query,
    results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  )
  // Conversations in the inbox list open as that row, so the list can show it.
  const synced = await getDb().mailMessage.findMany({
    where: { userId, OR: hits.map((hit) => ({ accountId: hit.accountId, threadId: hit.threadId })) },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { id: true, accountId: true, threadId: true },
  })
  const newest = new Map<string, string>()
  for (const row of synced) {
    const key = `${row.accountId}:${row.threadId}`
    if (!newest.has(key)) newest.set(key, row.id)
  }
  return {
    hits: hits.map((hit) => {
      const messageId = newest.get(`${hit.accountId}:${hit.threadId}`)
      return messageId ? { ...hit, messageId } : hit
    }),
    failedAccounts: accounts.flatMap((account, index) =>
      results[index]?.status === "rejected" ? [account.id] : []
    ),
  }
}

/**
 * Instant matches on what is already synced: sender and subject of the inbox.
 * Shown while the providers search, which also look through the text.
 */
export async function quickSearch(userId: string, query: string): Promise<MailSearchHit[]> {
  const words = searchWords(query)
  if (words.length === 0) return []
  const contains = (word: string) => ({ contains: word, mode: "insensitive" as const })
  const rows = await getDb().mailMessage.findMany({
    where: {
      userId,
      AND: words.map((word) => ({
        OR: [{ subject: contains(word) }, { fromName: contains(word) }, { fromEmail: contains(word) }],
      })),
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: MAX_SEARCH_HITS * 4,
  })
  const hits = rows.flatMap((row): MailSearchHit[] =>
    row.threadId
      ? [
          {
            accountId: row.accountId,
            threadId: row.threadId,
            subject: row.subject,
            snippet: row.snippet,
            fromName: row.fromName,
            fromEmail: row.fromEmail,
            receivedAt: row.receivedAt.toISOString(),
            isRead: row.isRead,
            hasAttachments: row.hasAttachments,
            messageId: row.id,
          },
        ]
      : []
  )
  return rankSearchHits(query, hits).slice(0, MAX_SEARCH_HITS)
}
