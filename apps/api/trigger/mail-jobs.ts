import { logger, task } from "@trigger.dev/sdk"

/** Something the mail API does at a set time: wake a snoozed conversation, or send a scheduled draft. */
export type MailJob = { kind: "snooze" | "send"; id: string }

/**
 * Waits (as a delayed run) until its moment, then asks the API to do the job.
 * Only the API touches mail and the database; this holds no mail secrets, just
 * the shared one that lets it knock. The API checks whether the job is still
 * due, so a snooze cancelled or moved since makes this a no-op.
 */
export const mailJob = task({
  id: "mail-job",
  retry: { maxAttempts: 6, factor: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 10 * 60_000, randomize: true },
  run: async (job: MailJob) => {
    const apiUrl = process.env.EVIDO_API_URL
    const secret = process.env.MAIL_JOBS_SECRET
    if (!apiUrl || !secret) throw new Error("Configure EVIDO_API_URL and MAIL_JOBS_SECRET")
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/mail/jobs/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(60_000),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(`The API answered ${response.status}: ${JSON.stringify(result)}`)
    logger.info("Mail job done", { job, result })
    return result
  },
})
