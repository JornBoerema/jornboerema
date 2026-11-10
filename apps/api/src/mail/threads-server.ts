import { getDb, Prisma, type MailAccount } from "@evido/db"
import {
  MAX_SEARCH_HITS,
  rankSearchHits,
  searchWords,
  type MailFolder,
  type MailFolderPage,
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
export async function readConversation(
  { account, threadId }: Conversation,
  options?: { includeHidden?: boolean }
): Promise<MailThreadDetail> {
  const messages = await withAccessToken(account, (provider, token) => provider.getThread(token, threadId, options))
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
        : (await provider.getThread(token, threadId, { includeHidden: true })).map((message) => message.id)
    await provider.applyThreadAction(token, { threadId, messageIds, action })
  })
  // Back in the inbox arrives through the next sync, with fresh metadata.
  if (action === "archive" || action === "trash") await db.mailMessage.deleteMany({ where })
  else if (action === "star" || action === "unstar")
    await db.mailMessage.updateMany({ where, data: { isStarred: action === "star" } })
  else if (action === "read" || action === "unread")
    await db.mailMessage.updateMany({ where, data: { isRead: action === "read" } })
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

export class InvalidFolderCursorError extends Error {}

/** Per mailbox where its next page starts; null once it has no more. */
type FolderCursor = Record<string, string | null>

function readFolderCursor(cursor: string | undefined): FolderCursor | null {
  if (!cursor) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as FolderCursor
  } catch {
    // Handled below.
  }
  throw new InvalidFolderCursorError()
}

/**
 * One page of a folder across every mailbox, newest first. Each mailbox pages on
 * its own, so the cursor remembers where each one is.
 */
export async function listFolder(userId: string, folder: MailFolder, cursor?: string): Promise<MailFolderPage> {
  const positions = readFolderCursor(cursor)
  const accounts = (await getDb().mailAccount.findMany({ where: { userId, status: "active" } })).filter(
    (account) => !positions || typeof positions[account.id] === "string"
  )
  const results = await Promise.allSettled(
    accounts.map((account) =>
      withAccessToken(account, (provider, token) =>
        provider.listFolder(token, { folder, pageToken: positions?.[account.id] ?? null })
      )
    )
  )
  const next: FolderCursor = {}
  const hits: MailSearchHit[] = []
  const failedAccounts: string[] = []
  results.forEach((result, index) => {
    const account = accounts[index]
    if (!account) return
    if (result.status === "rejected") {
      failedAccounts.push(account.id)
      console.error("Folder list failed", result.reason instanceof Error ? result.reason.message : "unknown")
      return
    }
    hits.push(...result.value.hits.map((hit) => ({ ...hit, accountId: account.id })))
    if (result.value.nextPageToken) next[account.id] = result.value.nextPageToken
  })
  hits.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  return {
    hits: await withSyncedIds(userId, hits),
    nextCursor: Object.keys(next).length > 0 ? Buffer.from(JSON.stringify(next)).toString("base64url") : null,
    failedAccounts,
  }
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
  return getDb().$queryRaw<MailContact[]>`
    SELECT email, name FROM (
      SELECT lower(from_email) AS email,
        (array_agg(from_name ORDER BY received_at DESC) FILTER (WHERE from_name IS NOT NULL AND from_name <> ''))[1] AS name,
        count(*) AS uses,
        max(received_at) AS last_seen
      FROM mail_messages
      WHERE user_id = ${userId}
        AND from_email IS NOT NULL
        AND from_email NOT ILIKE '%noreply%'
        AND from_email NOT ILIKE '%no-reply%'
        AND from_email NOT ILIKE '%donotreply%'
        AND (from_email ILIKE ${anywhere} OR from_name ILIKE ${anywhere})
      GROUP BY lower(from_email)
    ) contacts
    ORDER BY (email ILIKE ${start} OR name ILIKE ${start} OR name ILIKE ${word}) DESC, uses DESC, last_seen DESC
    LIMIT 8
  `
}
