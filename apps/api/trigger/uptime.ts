import { sendEmail } from "@even/email"
import { logger, schedules } from "@trigger.dev/sdk"
import pg from "pg"

/**
 * The uptime monitor behind status.jornboerema.nl. Every minute this knocks on
 * the website, the web app and the API, writes what it saw to `uptime_checks`
 * and keeps `uptime_incidents` up to date. It runs on Trigger.dev, not Vercel,
 * so it keeps watching when Vercel is the thing that is down.
 *
 * Writes straight to Neon (DATABASE_URL) instead of through the API, for the
 * same reason. A mail goes to UPTIME_ALERT_TO when a monitor goes down (two
 * failed checks in a row, so a single blip stays quiet) and when it is back.
 */

type Monitor = { id: string; name: string; url: string; expect?: (body: string) => boolean }

/** Keep in step with MONITORS in apps/status/src/monitors.ts. */
const MONITORS: Monitor[] = [
  { id: "website", name: "Website", url: "https://www.jornboerema.nl/" },
  { id: "app", name: "Even web-app", url: "https://app.jornboerema.nl/login" },
  { id: "api", name: "API", url: "https://api.jornboerema.nl/health", expect: (body) => body.includes('"ok":true') },
]

const TIMEOUT_MS = 15_000
/** Checks are kept this long; the status page shows 90 days. */
const KEEP_DAYS = 100

type Result = { monitor: Monitor; ok: boolean; status: number | null; latencyMs: number | null; error: string | null }

async function probeOnce(monitor: Monitor): Promise<Result> {
  const started = performance.now()
  try {
    const response = await fetch(monitor.url, {
      headers: { "User-Agent": "EvenUptime/1 (+https://status.jornboerema.nl)", "Cache-Control": "no-cache" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await response.text()
    const latencyMs = Math.round(performance.now() - started)
    if (!response.ok) return { monitor, ok: false, status: response.status, latencyMs, error: `HTTP ${response.status}` }
    if (monitor.expect && !monitor.expect(body))
      return { monitor, ok: false, status: response.status, latencyMs, error: "Onverwacht antwoord" }
    return { monitor, ok: true, status: response.status, latencyMs, error: null }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    const message = timedOut ? `Geen antwoord binnen ${TIMEOUT_MS / 1000} s` : error instanceof Error ? error.message : String(error)
    return { monitor, ok: false, status: null, latencyMs: null, error: message.slice(0, 300) }
  }
}

/** A failed check is tried once more after a short wait, so a dropped packet isn't an outage. */
async function probe(monitor: Monitor): Promise<Result> {
  const first = await probeOnce(monitor)
  if (first.ok) return first
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  return probeOnce(monitor)
}

function duration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} u ${minutes % 60} min`
}

async function alert(subject: string, text: string) {
  const to = process.env.UPTIME_ALERT_TO
  if (!to) return logger.warn("UPTIME_ALERT_TO is not set; no mail sent", { subject })
  try {
    await sendEmail({ to, subject, text })
  } catch (error) {
    // A mail that fails must not stop the checks from being written.
    logger.error("Alert mail failed", { subject, error: String(error) })
  }
}

export const uptimeCheck = schedules.task({
  id: "uptime-check",
  // Every minute, on the minute: no spreading window.
  cron: { pattern: "* * * * *", window: "0m" },
  machine: "micro",
  maxDuration: 60,
  queue: { concurrencyLimit: 1 },
  // The next minute is the retry.
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL")
    const results = await Promise.all(MONITORS.map(probe))
    const checkedAt = payload.timestamp

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 })
    await client.connect()
    try {
      await client.query(
        `INSERT INTO uptime_checks (monitor, checked_at, ok, status, latency_ms, error)
         SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::bool[], $4::int[], $5::int[], $6::text[])`,
        [
          results.map((r) => r.monitor.id),
          results.map(() => checkedAt),
          results.map((r) => r.ok),
          results.map((r) => r.status),
          results.map((r) => r.latencyMs),
          results.map((r) => r.error),
        ]
      )

      for (const result of results) {
        const { monitor } = result
        const open = await client.query<{ id: string; started_at: Date }>(
          `SELECT id, started_at FROM uptime_incidents WHERE monitor = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
          [monitor.id]
        )
        const incident = open.rows[0]

        if (result.ok && incident) {
          await client.query(`UPDATE uptime_incidents SET ended_at = $2 WHERE id = $1`, [incident.id, checkedAt])
          const lasted = duration(checkedAt.getTime() - incident.started_at.getTime())
          logger.info("Monitor is back", { monitor: monitor.id, lasted })
          await alert(
            `✅ ${monitor.name} is weer bereikbaar`,
            `${monitor.name} (${monitor.url}) doet het weer, na ${lasted} storing.\n\nhttps://status.jornboerema.nl`
          )
        } else if (!result.ok && !incident) {
          // Down only when the check before this one failed too.
          const previous = await client.query<{ ok: boolean; checked_at: Date; error: string | null }>(
            `SELECT ok, checked_at, error FROM uptime_checks WHERE monitor = $1 AND checked_at < $2 ORDER BY checked_at DESC LIMIT 1`,
            [monitor.id, checkedAt]
          )
          const before = previous.rows[0]
          if (before && !before.ok) {
            const cause = before.error ?? result.error ?? "Onbekend"
            await client.query(
              `INSERT INTO uptime_incidents (id, monitor, started_at, cause) VALUES ($1, $2, $3, $4)`,
              [crypto.randomUUID(), monitor.id, before.checked_at, cause]
            )
            logger.warn("Monitor is down", { monitor: monitor.id, cause })
            await alert(
              `🔴 ${monitor.name} is onbereikbaar`,
              `${monitor.name} (${monitor.url}) geeft sinds ${before.checked_at.toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam" })} geen goed antwoord.\n\nOorzaak: ${cause}\n\nhttps://status.jornboerema.nl`
            )
          }
        }
      }

      if (checkedAt.getUTCMinutes() === 0 && checkedAt.getUTCHours() === 3)
        await client.query(`DELETE FROM uptime_checks WHERE checked_at < now() - make_interval(days => $1)`, [KEEP_DAYS])
    } finally {
      await client.end()
    }

    return results.map((r) => ({ monitor: r.monitor.id, ok: r.ok, status: r.status, latencyMs: r.latencyMs, error: r.error }))
  },
})
