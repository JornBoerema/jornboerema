import { randomUUID } from "node:crypto"
import { idempotencyKeys, tasks } from "@trigger.dev/sdk"
import { getDb } from "@evido/db"
import type { MailAddress, MailScheduledView, MailSnoozedView } from "@evido/mail-core/types"
import type { mailJob, MailJob } from "../../trigger/mail-jobs"
import { notifyMailChanged } from "../lib/realtime"
import { ownedAccount, withAccessToken } from "./accounts-server"
import type { DraftSave } from "./drafts-server"
import { actOnConversation, MailMessageNotFoundError, threadLines, type Conversation } from "./threads-server"

// Snoozing and sending later: both wait for a moment, which a delayed
// Trigger.dev run brings (see trigger/mail-jobs.ts). Whatever is overdue is
// also done when its owner next opens the inbox and by the daily cron, so
// nothing is lost if a run never comes.

/** Runs may knock a little early; this much counts as on time. */
const EARLY_MS = 60_000
/** A woken conversation stays on top of the inbox this long, until read. */
const RETURNED_DAYS = 3
/** At most this many overdue jobs per catch-up, to stay within the function limit. */
const CATCH_UP_LIMIT = 10

const due = () => new Date(Date.now() + EARLY_MS)

/** Asks Trigger.dev to knock at `at`. Without its key (development) the catch-up does it. */
async function scheduleJob(job: MailJob, at: Date) {
  if (!process.env.TRIGGER_SECRET_KEY) return
  try {
    const idempotencyKey = await idempotencyKeys.create(`${job.kind}:${job.id}:${at.toISOString()}`, { scope: "global" })
    await tasks.trigger<typeof mailJob>("mail-job", job, {
      delay: at,
      idempotencyKey,
      tags: [`mail-${job.kind}`],
      // Next to the API (Vercel fra1) and the database, not in the US default.
      region: "eu-central-1",
    })
  } catch (error) {
    // The catch-up still does it; the user's action shouldn't fail for this.
    console.error("Scheduling a mail job failed", error)
  }
}

// ─── Snoozing ────────────────────────────────────────────────────────────────

/** Archives the conversation now and has it back in the inbox at `until`. */
export async function snooze(conversation: Conversation, until: Date) {
  const { account, threadId } = conversation
  await actOnConversation(conversation, "archive")
  const row = await getDb().mailSnooze.upsert({
    where: { accountId_threadId: { accountId: account.id, threadId } },
    create: { id: randomUUID(), userId: account.userId, accountId: account.id, threadId, until },
    update: { until, wokeAt: null },
  })
  await scheduleJob({ kind: "snooze", id: row.id }, until)
  return { until: until.toISOString() }
}

/** Back in the inbox now, snoozed or not. */
export async function unsnooze(conversation: Conversation) {
  const { account, threadId } = conversation
  await getDb().mailSnooze.deleteMany({ where: { accountId: account.id, threadId } })
  await actOnConversation(conversation, "inbox")
}

async function wake(id: string) {
  const db = getDb()
  const row = await db.mailSnooze.findUnique({ where: { id }, include: { account: true } })
  if (!row || row.wokeAt || row.until > due()) return false
  const conversation = { account: row.account, threadId: row.threadId }
  await actOnConversation(conversation, "inbox")
  // Back as new, the way Gmail returns snoozed mail.
  await actOnConversation(conversation, "unread").catch(() => undefined)
  await db.mailSnooze.update({ where: { id }, data: { wokeAt: new Date() } })
  await notifyMailChanged(row.userId).catch(() => undefined)
  return true
}

/** Conversations waiting, soonest first, and those just back, for the inbox's top. */
export async function listSnoozes(userId: string): Promise<{ snoozed: MailSnoozedView[]; returned: MailSnoozedView[] }> {
  const db = getDb()
  const since = new Date(Date.now() - RETURNED_DAYS * 24 * 60 * 60 * 1000)
  const rows = await db.mailSnooze.findMany({
    where: { userId, OR: [{ wokeAt: null }, { wokeAt: { gte: since } }] },
    orderBy: { until: "asc" },
  })
  const threads = await threadLines(userId, rows)
  const view = (row: (typeof rows)[number]): MailSnoozedView | null => {
    const thread = threads.get(`${row.accountId}:${row.threadId}`)
    return thread ? { thread, until: row.until.toISOString() } : null
  }
  return {
    snoozed: rows.filter((row) => !row.wokeAt).flatMap((row) => view(row) ?? []),
    // Read since it came back: it takes its own place in the list again.
    returned: rows
      .filter((row) => row.wokeAt)
      .flatMap((row) => view(row) ?? [])
      .filter((row) => !row.thread.isRead),
  }
}

// ─── Sending later ───────────────────────────────────────────────────────────

/** Saves the message as a draft at the provider, to be sent from there at `sendAt`. */
export async function scheduleSend(userId: string, accountId: string, input: DraftSave, sendAt: Date) {
  const account = await ownedAccount(userId, accountId)
  const draftId = await withAccessToken(account, (provider, token) =>
    provider.saveDraft(token, { ...input, from: { name: account.displayName, email: account.email } })
  )
  const to: MailAddress[] = input.to
  const row = await getDb().mailScheduledSend.upsert({
    where: { accountId_draftId: { accountId, draftId } },
    create: { id: randomUUID(), userId, accountId, draftId, sendAt, subject: input.subject, toAddresses: to },
    update: { sendAt, subject: input.subject, toAddresses: to, failedAt: null, error: null },
  })
  await scheduleJob({ kind: "send", id: row.id }, sendAt)
  return { id: row.id, sendAt: sendAt.toISOString() }
}

async function sendScheduled(id: string, now = false) {
  const db = getDb()
  const row = await db.mailScheduledSend.findUnique({ where: { id }, include: { account: true } })
  if (!row || row.failedAt || (!now && row.sendAt > due())) return false
  try {
    await withAccessToken(row.account, (provider, token) => provider.sendDraft(token, row.draftId))
    await db.mailScheduledSend.delete({ where: { id } })
  } catch (error) {
    // Kept, marked, so the Scheduled list says it didn't go and the draft can be opened.
    await db.mailScheduledSend.update({
      where: { id },
      data: { failedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
    })
  }
  await notifyMailChanged(row.userId).catch(() => undefined)
  return true
}

export async function listScheduled(userId: string): Promise<MailScheduledView[]> {
  const rows = await getDb().mailScheduledSend.findMany({ where: { userId }, orderBy: { sendAt: "asc" } })
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    draftId: row.draftId,
    subject: row.subject,
    to: row.toAddresses as MailAddress[],
    sendAt: row.sendAt.toISOString(),
    failed: row.failedAt !== null,
  }))
}

/** Drafts that are waiting to go out, which the Drafts list leaves to Scheduled. */
export async function scheduledDraftIds(userId: string) {
  const rows = await getDb().mailScheduledSend.findMany({ where: { userId, failedAt: null }, select: { accountId: true, draftId: true } })
  return new Set(rows.map((row) => `${row.accountId}:${row.draftId}`))
}

async function ownedScheduled(userId: string, id: string) {
  const row = await getDb().mailScheduledSend.findFirst({ where: { id, userId } })
  if (!row) throw new MailMessageNotFoundError()
  return row
}

/** Not sent after all: the draft stays at the provider, to open and change. */
export async function cancelScheduled(userId: string, id: string) {
  const row = await ownedScheduled(userId, id)
  await getDb().mailScheduledSend.delete({ where: { id } })
  return { accountId: row.accountId, draftId: row.draftId }
}

export async function sendScheduledNow(userId: string, id: string) {
  await ownedScheduled(userId, id)
  await getDb().mailScheduledSend.update({ where: { id }, data: { failedAt: null, error: null } })
  await sendScheduled(id, true)
}

// ─── Running jobs ────────────────────────────────────────────────────────────

/** A job a delayed run knocked for; it does nothing if no longer due. */
export async function runJob(job: MailJob) {
  return job.kind === "snooze" ? wake(job.id) : sendScheduled(job.id)
}

/**
 * Everything overdue, for one user (as their inbox opens) or for everyone (the
 * daily cron): a missed run is made up for here.
 */
export async function catchUp(userId?: string) {
  const db = getDb()
  const [snoozes, sends] = await Promise.all([
    db.mailSnooze.findMany({
      where: { wokeAt: null, until: { lte: due() }, ...(userId && { userId }) },
      select: { id: true },
      take: CATCH_UP_LIMIT,
    }),
    db.mailScheduledSend.findMany({
      where: { failedAt: null, sendAt: { lte: due() }, ...(userId && { userId }) },
      select: { id: true },
      take: CATCH_UP_LIMIT,
    }),
  ])
  for (const { id } of snoozes) await wake(id).catch((error) => console.error("Waking a snooze failed", error))
  for (const { id } of sends) await sendScheduled(id).catch((error) => console.error("A scheduled send failed", error))
  return { woke: snoozes.length, sent: sends.length }
}
