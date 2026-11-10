import { getDb, Prisma, type MailAccount } from "@evido/db"
import {
  MAX_SEARCH_HITS,
  rankSearchHits,
  searchWords,
  type MailFolder,
  type MailAddress,
  type MailForward,
  type MailOutgoing,
  type MailReply,
  type MailSearchHit,
  type MailThreadAction,
  type MailThreadDetail,
  type MailThreadsPage,
  type MailThreadView,
} from "@evido/mail-core/types"
import type { MailMessageFolder } from "@evido/mail-core/provider"
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

type ThreadRow = Omit<MailThreadView, "receivedAt" | "to"> & { receivedAt: Date; to: MailAddress[] }

/** Conversations newest first, across every mailbox or the one in `accountId`. */
export async function listThreads(
  userId: string,
  {
    accountId,
    cursor,
    folder = "inbox",
    unreadOnly,
    limit = PAGE_SIZE,
  }: {
    accountId?: string
    cursor?: string
    /** The inbox, another synced folder, or starred mail from any of them but spam and trash. */
    folder?: "inbox" | MailFolder
    unreadOnly?: boolean
    limit?: number
  }
): Promise<MailThreadsPage> {
  const position = cursor ? parseCursor(cursor) : null
  const accountFilter = accountId ? Prisma.sql`AND account_id = ${accountId}` : Prisma.empty
  // A conversation is grouped within the folder, so a line describes what is there.
  const folderFilter =
    folder === "starred"
      ? Prisma.sql`AND folder NOT IN ('spam', 'trash')`
      : Prisma.sql`AND folder = ${folder}::mail_message_folder`
  const starredOnly = folder === "starred" ? Prisma.sql`AND any_starred` : Prisma.empty
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
      message_count::int AS "messageCount",
      to_addresses AS "to"
    FROM (
      SELECT *,
        row_number() OVER (conversation ORDER BY received_at DESC, id DESC) AS position,
        count(*) OVER conversation AS message_count,
        bool_and(is_read) OVER conversation AS all_read,
        bool_or(is_starred) OVER conversation AS any_starred,
        bool_or(has_attachments) OVER conversation AS any_attachment
      FROM mail_messages
      WHERE user_id = ${userId} ${accountFilter} ${folderFilter}
      WINDOW conversation AS (PARTITION BY account_id, coalesce(thread_id, id))
    ) grouped
    WHERE position = 1 ${after} ${starredOnly} ${unreadOnly ? Prisma.sql`AND NOT all_read` : Prisma.empty}
    ORDER BY received_at DESC, id DESC
    LIMIT ${limit + 1}
  `
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    // Recipients only matter where lines name them instead of the sender.
    threads: page.map(({ to, ...row }) => ({
      ...row,
      receivedAt: row.receivedAt.toISOString(),
      ...(folder === "sent" && { to }),
    })),
    nextCursor: rows.length > limit && last ? `${last.receivedAt.toISOString()}|${last.id}` : null,
  }
}

/** How many inbox conversations have unread mail, and the newest few of them. */
export async function unreadSummary(userId: string) {
  const [count] = await getDb().$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (
      SELECT 1 FROM mail_messages
      WHERE user_id = ${userId} AND folder = 'inbox'
      GROUP BY account_id, coalesce(thread_id, id)
      HAVING NOT bool_and(is_read)
    ) unread
  `
  const { threads } = await listThreads(userId, { unreadOnly: true, limit: 5 })
  return { count: count?.count ?? 0, latest: threads }
}

/** `hidden` when it was found in spam or trash, which normal reading leaves out. */
type Conversation = { account: MailAccount; threadId: string; hidden?: boolean }

async function ownedMessage(userId: string, messageId: string): Promise<Conversation> {
  const message = await getDb().mailMessage.findFirst({
    where: { id: messageId, userId },
    include: { account: true },
  })
  if (!message?.threadId) throw new MailMessageNotFoundError()
  return {
    account: message.account,
    threadId: message.threadId,
    hidden: message.folder === "spam" || message.folder === "trash",
  }
}

/** A conversation by its provider id, such as one search found outside the synced inbox. */
export async function ownedConversation(userId: string, accountId: string, threadId: string): Promise<Conversation> {
  return { account: await ownedAccount(userId, accountId), threadId }
}

/** Reads a conversation live from the provider. Nothing from it is written to the database. */
export async function readConversation(
  { account, threadId }: Conversation,
  options?: { includeHidden?: boolean }
): Promise<MailThreadDetail> {
  const messages = await withAccessToken(account, (provider, token) => provider.getThread(token, threadId, options))
  return { messages }
}

/** Changes the mailbox first; the list only follows once the provider has accepted it. */
/** Which of a conversation's synced messages an action is about. */
const AFFECTS: Partial<Record<MailThreadAction, MailMessageFolder[]>> = {
  archive: ["inbox"],
  inbox: ["archive", "spam", "trash"],
}

/**
 * Changes the mailbox first; the list only follows once the provider has accepted
 * it. The next sync then confirms where everything ended up.
 */
export async function actOnConversation({ account, threadId }: Conversation, action: MailThreadAction) {
  const db = getDb()
  const where = {
    accountId: account.id,
    threadId,
    ...(AFFECTS[action] && { folder: { in: AFFECTS[action] } }),
  }
  const rows = await db.mailMessage.findMany({ where, select: { providerMessageId: true } })
  await withAccessToken(account, async (provider, token) => {
    // Not synced, like mail older than the window: ask the provider.
    const messageIds =
      rows.length > 0
        ? rows.map((row) => row.providerMessageId)
        : (await provider.getThread(token, threadId, { includeHidden: true })).map((message) => message.id)
    await provider.applyThreadAction(token, { threadId, messageIds, action })
  })
  const data =
    action === "archive"
      ? { folder: "archive" as const }
      : action === "trash"
        ? { folder: "trash" as const }
        : action === "inbox"
          ? { folder: "inbox" as const }
          : action === "star" || action === "unstar"
            ? { isStarred: action === "star" }
            : { isRead: action === "read" }
  await db.mailMessage.updateMany({ where, data })
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

export async function readThread(userId: string, messageId: string) {
  const conversation = await ownedMessage(userId, messageId)
  return readConversation(conversation, { includeHidden: conversation.hidden })
}

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

/** Conversations in the inbox list open as that row, so the list can show it. */
async function withSyncedIds(userId: string, hits: MailSearchHit[]) {
  if (hits.length === 0) return hits
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
  return hits.map((hit) => {
    const messageId = newest.get(`${hit.accountId}:${hit.threadId}`)
    return messageId ? { ...hit, messageId } : hit
  })
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
  return {
    hits: await withSyncedIds(userId, hits),
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
      folder: { notIn: ["spam", "trash"] },
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

export type MailContact = { name: string | null; email: string }

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)

/**
 * People who wrote to this user, for completing an address. Most frequent and
 * most recent first; a name or address that starts with what's typed beats one
 * that only contains it. Automated senders are left out.
 */
export async function suggestContacts(userId: string, query: string): Promise<MailContact[]> {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return []
  const anywhere = `%${likeEscape(term)}%`
  const start = `${likeEscape(term)}%`
  const word = `% ${likeEscape(term)}%`
  // People who wrote, and people this user wrote to; not the user's own mailboxes.
  return getDb().$queryRaw<MailContact[]>`
    WITH people AS (
      SELECT lower(from_email) AS email, from_name AS name, received_at
      FROM mail_messages
      WHERE user_id = ${userId} AND folder NOT IN ('sent', 'spam') AND from_email IS NOT NULL
      UNION ALL
      SELECT lower(recipient->>'email'), recipient->>'name', received_at
      FROM mail_messages, jsonb_array_elements(to_addresses) AS recipient
      WHERE user_id = ${userId} AND folder = 'sent'
    )
    SELECT email, name FROM (
      SELECT email,
        (array_agg(name ORDER BY received_at DESC) FILTER (WHERE name IS NOT NULL AND name <> ''))[1] AS name,
        count(*) AS uses,
        max(received_at) AS last_seen
      FROM people
      WHERE email IS NOT NULL
        AND email NOT ILIKE '%noreply%'
        AND email NOT ILIKE '%no-reply%'
        AND email NOT ILIKE '%donotreply%'
        AND email NOT IN (SELECT lower(email) FROM mail_accounts WHERE user_id = ${userId})
        AND (email ILIKE ${anywhere} OR name ILIKE ${anywhere})
      GROUP BY email
    ) contacts
    ORDER BY (email ILIKE ${start} OR name ILIKE ${start} OR name ILIKE ${word}) DESC, uses DESC, last_seen DESC
    LIMIT 8
  `
}
