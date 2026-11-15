import { logger, task, wait } from "@trigger.dev/sdk"

/** A mailbox that still has its past year of mail to fetch. */
export type MailBackfill = { accountId: string }

/** What the API answers for one round; the same shape the app's sync gets. */
type Round = { done: boolean; busy: boolean; rateLimited: boolean; changed: number; stored?: number }

/** Plenty for a year of mail: each round fetches for up to 8s, and waits don't count. */
const MAX_ROUNDS = 2000

/**
 * Fetches a newly connected mailbox's past year in the background, round
 * after round, so it fills up whether or not the app is open. Like mail-job it
 * only knocks: the API does the work, one sync per mailbox at a time, and the
 * app's own sync carries on alongside it.
 */
export const mailBackfill = task({
  id: "mail-backfill",
  // An hour of compute; the pauses between rounds are free.
  maxDuration: 3600,
  queue: { concurrencyLimit: 5 },
  retry: { maxAttempts: 4, factor: 3, minTimeoutInMs: 10_000, maxTimeoutInMs: 10 * 60_000, randomize: true },
  run: async ({ accountId }: MailBackfill) => {
    const apiUrl = process.env.EVEN_API_URL
    const secret = process.env.MAIL_JOBS_SECRET
    if (!apiUrl || !secret) throw new Error("Configure EVEN_API_URL and MAIL_JOBS_SECRET")
    let changed = 0
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/mail/jobs/backfill`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
        signal: AbortSignal.timeout(60_000),
      })
      // Gone (disconnected) or its access lost: nothing left to fetch.
      if (response.status === 404 || response.status === 409) return { stopped: response.status, changed }
      const result = (await response.json().catch(() => null)) as Round | null
      if (!response.ok || !result) throw new Error(`The API answered ${response.status}`)
      changed += result.changed
      if (result.done) {
        logger.info("Backfill done", { accountId, rounds: round + 1, changed, stored: result.stored })
        return { done: true, changed }
      }
      if (result.rateLimited) await wait.for({ seconds: 30 })
      else if (result.busy) await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    return { done: false, changed }
  },
})
