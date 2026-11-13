import { getDb, type MailAccount } from "@evido/db"
import { secretsMatch, webhookClientState } from "@evido/mail-core/secrets"
import { mailEmails, sendEmail } from "@evido/email"
import { ReauthRequiredError } from "@evido/mail-core/provider"
import { z } from "zod"
import { defer } from "../lib/defer"
import { report } from "../lib/report"
import { notifyMailChanged } from "../lib/realtime"
import { env } from "../env"
import { withAccessToken } from "./accounts-server"
import { syncAccount } from "./sync-server"

/** Renewed this long before expiry, so one missed daily run changes nothing. */
const RENEW_BEFORE_MS = 3 * 24 * 60 * 60 * 1000
const RENEW_CONCURRENCY = 5
/** The daily run shares one 30 second function; what is left waits a day, well inside the margin. */
const RENEW_BUDGET_MS = 18 * 1000

const webhookSecret = () => process.env.MAIL_WEBHOOK_SECRET ?? ""

export function authorizeGmailWebhook(token: string | undefined) {
  const secret = webhookSecret()
  return Boolean(secret && token && secretsMatch(token, secret))
}

export function authorizeCron(header: string | undefined) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret && header && secretsMatch(header, `Bearer ${secret}`))
}

/** Starts or renews notifications. Polling still works if this fails. */
export async function ensureWatch(account: MailAccount) {
  const secret = webhookSecret()
  if (!secret) return
  const watch = await withAccessToken(account, (provider, token) =>
    provider.watch(token, {
      webhookUrl: `${env.apiUrl}/api/mail/webhook/outlook`,
      gmailTopic: process.env.GMAIL_PUBSUB_TOPIC ?? null,
      clientState: webhookClientState(secret, account.id),
      existingId: account.watchId,
    })
  )
  await getDb().mailAccount.update({
    where: { id: account.id },
    data: { watchId: watch.id, watchExpiresAt: watch.expiresAt },
  })
}

export async function renewWatches() {
  const accounts = await getDb().mailAccount.findMany({
    where: {
      status: "active",
      OR: [
        { watchExpiresAt: null },
        { watchExpiresAt: { lt: new Date(Date.now() + RENEW_BEFORE_MS) } },
      ],
    },
    // Closest to expiring first, so a run that runs out of time leaves the least urgent.
    orderBy: { watchExpiresAt: { sort: "asc", nulls: "first" } },
  })
  let renewed = 0
  let failed = 0
  const reasons = new Set<string>()
  const deadline = Date.now() + RENEW_BUDGET_MS
  let start = 0
  for (; start < accounts.length && Date.now() < deadline; start += RENEW_CONCURRENCY) {
    const results = await Promise.allSettled(
      accounts.slice(start, start + RENEW_CONCURRENCY).map(ensureWatch)
    )
    for (const result of results) {
      if (result.status === "fulfilled") renewed++
      // A mailbox whose access ended is no failure: its owner was told to connect it again.
      else if (!(result.reason instanceof ReauthRequiredError)) {
        failed++
        const reason = result.reason instanceof Error ? result.reason.message : "unknown"
        reasons.add(reason.slice(0, 200))
        report("Mail watch renewal failed", result.reason)
      }
    }
  }
  const left = Math.max(0, accounts.length - start)
  if (failed > 0)
    for (const to of env.adminEmails)
      defer(() => sendEmail(mailEmails.watchesFailed({ to, failed, renewed, reasons: [...reasons].slice(0, 10) })))
  return { renewed, failed, left }
}

async function syncAndNotify(account: MailAccount) {
  try {
    const result = await syncAccount(account.userId, account.id)
    if (result.changed > 0) await notifyMailChanged(account.userId)
  } catch (error) {
    // The cursor kept its place, so the next notification or poll catches up.
    // A mailbox that lost access is its owner's to fix, and they were told.
    if (!(error instanceof ReauthRequiredError)) report("Webhook sync failed", error)
  }
}

const gmailEnvelope = z.object({ message: z.object({ data: z.string().max(4096) }) })
const gmailPayload = z.object({ emailAddress: z.string().max(320) })

export async function handleGmailNotification(body: unknown) {
  const envelope = gmailEnvelope.safeParse(body)
  if (!envelope.success) return
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(envelope.data.message.data, "base64").toString("utf8"))
  } catch {
    return
  }
  const payload = gmailPayload.safeParse(decoded)
  if (!payload.success) return
  const accounts = await getDb().mailAccount.findMany({
    where: {
      provider: "gmail",
      status: "active",
      email: { equals: payload.data.emailAddress, mode: "insensitive" },
    },
  })
  await Promise.all(accounts.map(syncAndNotify))
}

const outlookBatch = z.object({
  value: z
    .array(z.object({ subscriptionId: z.string().max(200), clientState: z.string().max(200) }))
    .max(1000),
})

export async function handleOutlookNotifications(body: unknown) {
  const batch = outlookBatch.safeParse(body)
  const secret = webhookSecret()
  if (!batch.success || !secret) return
  const ids = [...new Set(batch.data.value.map((item) => item.subscriptionId))]
  const accounts = await getDb().mailAccount.findMany({
    where: { watchId: { in: ids }, provider: "outlook", status: "active" },
  })
  const genuine = accounts.filter((account) => {
    const expected = webhookClientState(secret, account.id)
    return batch.data.value.some(
      (item) => item.subscriptionId === account.watchId && secretsMatch(item.clientState, expected)
    )
  })
  await Promise.all(genuine.map(syncAndNotify))
}
