import { createHash } from "node:crypto"
import { getDb, type MailAccount } from "@evido/db"
import {
  isRateLimited,
  SyncCursorExpiredError,
  type MailMessageData,
  type SyncPage,
} from "@evido/mail-core/provider"
import type { MailSyncResult } from "@evido/mail-core/types"
import { ownedAccount, withAccessToken } from "./accounts-server"

const WINDOW_MS = 90 * 24 * 60 * 60 * 1000
/** Stops starting new pages in time to answer within the 30s function limit. */
const BUDGET_MS = 20 * 1000
/** Outlives a function killed at its limit, so a crash cannot block sync for long. */
const LOCK_MS = 45 * 1000

const messageId = (accountId: string, providerMessageId: string) =>
  createHash("sha256").update(`${accountId}:${providerMessageId}`).digest("base64url")

const windowStart = () => new Date(Date.now() - WINDOW_MS)

function toRow(account: MailAccount, data: MailMessageData) {
  return {
    ...data,
    id: messageId(account.id, data.providerMessageId),
    userId: account.userId,
    accountId: account.id,
  }
}

/** Saves a page and its cursor as one unit, so a crash replays it instead of losing it. */
async function applyPage(account: MailAccount, page: SyncPage, since: Date) {
  const db = getDb()
  // Graph reports read-state changes on older mail too; those stay outside the window.
  const rows = page.upserts.filter((item) => item.receivedAt >= since).map((item) => toRow(account, item))
  const stale = [
    ...rows.map((row) => row.id),
    ...page.removals.map((id) => messageId(account.id, id)),
  ]
  await db.$transaction([
    db.mailMessage.deleteMany({ where: { id: { in: stale } } }),
    db.mailMessage.createMany({ data: rows }),
    db.mailAccount.update({
      where: { id: account.id },
      data: { syncCursor: page.cursor, syncSince: since },
    }),
  ])
  return rows.length + page.removals.length
}

/** Rows from the abandoned sync could never be corrected, so a full sync starts empty. */
async function restart(account: MailAccount, since: Date) {
  const db = getDb()
  await db.$transaction([
    db.mailMessage.deleteMany({ where: { accountId: account.id } }),
    db.mailAccount.update({
      where: { id: account.id },
      data: { syncCursor: null, syncSince: since },
    }),
  ])
}

async function acquireLock(accountId: string) {
  const now = new Date()
  const { count } = await getDb().mailAccount.updateMany({
    where: {
      id: accountId,
      OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
    },
    data: { syncLockedUntil: new Date(now.getTime() + LOCK_MS) },
  })
  return count === 1
}

/** Advances one mailbox for as long as the time budget allows. */
export async function syncAccount(userId: string, id: string): Promise<MailSyncResult> {
  const account = await ownedAccount(userId, id)
  if (!(await acquireLock(account.id))) return { done: false, busy: true, rateLimited: false, changed: 0 }

  try {
    return await withAccessToken(account, async (provider, token) => {
      let cursor = account.syncCursor
      let since = account.syncSince ?? windowStart()
      let changed = 0
      const deadline = Date.now() + BUDGET_MS

      while (Date.now() < deadline) {
        let page: SyncPage
        try {
          page = await provider.syncPage(token, { cursor, since })
        } catch (error) {
          if (isRateLimited(error)) return { done: false, busy: false, rateLimited: true, changed }
          if (!(error instanceof SyncCursorExpiredError) || !cursor) throw error
          cursor = null
          since = windowStart()
          await restart(account, since)
          continue
        }
        changed += await applyPage(account, page, since)
        cursor = page.cursor
        if (page.done) return { done: true, busy: false, rateLimited: false, changed }
      }
      return { done: false, busy: false, rateLimited: false, changed }
    })
  } finally {
    await getDb().mailAccount.update({
      where: { id: account.id },
      data: { syncLockedUntil: null },
    })
  }
}
