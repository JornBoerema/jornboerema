import { getDb, type MailAccount } from "@evido/db"
import { secretsMatch, webhookClientState } from "@evido/mail-core/secrets"
import { z } from "zod"
import { notifyMailChanged } from "../lib/realtime"
import { env } from "../env"
import { withAccessToken } from "./accounts-server"
import { syncAccount } from "./sync-server"

/** Renewed this long before expiry, so one missed daily run changes nothing. */
const RENEW_BEFORE_MS = 3 * 24 * 60 * 60 * 1000
const RENEW_CONCURRENCY = 5

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
  })
  let renewed = 0
  let failed = 0
  for (let start = 0; start < accounts.length; start += RENEW_CONCURRENCY) {
    const results = await Promise.allSettled(
      accounts.slice(start, start + RENEW_CONCURRENCY).map(ensureWatch)
    )
    for (const result of results) {
      if (result.status === "fulfilled") renewed++
      else {
        failed++
        console.error(
          "Mail watch renewal failed",
          result.reason instanceof Error ? result.reason.message : "unknown"
        )
      }
    }
  }
  return { renewed, failed }
}

async function syncAndNotify(account: MailAccount) {
  try {
    const result = await syncAccount(account.userId, account.id)
    if (result.changed > 0) await notifyMailChanged(account.userId)
  } catch (error) {
    // The cursor kept its place, so the next notification or poll catches up.
    console.error("Webhook sync failed", error instanceof Error ? error.message : "unknown")
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
