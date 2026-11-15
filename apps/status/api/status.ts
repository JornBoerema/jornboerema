import pg from "pg"
import { DAYS, MONITORS, type StatusData } from "../src/monitors.js"

/**
 * GET /api/status: what status.jornboerema.nl draws. Reads the checks that the
 * Trigger.dev task `uptime-check` writes to Neon. Cached at Vercel's edge for
 * 30 seconds, so a busy page during an outage costs one query a half minute.
 */

let pool: pg.Pool | undefined

function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ontbreekt.")
  return (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10_000 }))
}

const ZONE = "Europe/Amsterdam"

export async function readStatus(): Promise<StatusData> {
  const ids = MONITORS.map((m) => m.id)
  const [latest, days, incidents] = await Promise.all([
    db().query<{ monitor: string; ok: boolean; checked_at: Date; latency_ms: number | null }>(
      `SELECT DISTINCT ON (monitor) monitor, ok, checked_at, latency_ms
         FROM uptime_checks WHERE monitor = ANY($1) AND checked_at > now() - interval '1 day'
        ORDER BY monitor, checked_at DESC`,
      [ids]
    ),
    db().query<{ monitor: string; day: string; total: number; ok: number }>(
      `SELECT monitor, to_char(checked_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
              count(*)::int AS total, count(*) FILTER (WHERE ok)::int AS ok
         FROM uptime_checks
        WHERE monitor = ANY($1) AND checked_at >= (date_trunc('day', now() AT TIME ZONE $2) - make_interval(days => $3)) AT TIME ZONE $2
        GROUP BY 1, 2`,
      [ids, ZONE, DAYS - 1]
    ),
    db().query<{ monitor: string; started_at: Date; ended_at: Date | null; cause: string }>(
      `SELECT monitor, started_at, ended_at, cause FROM uptime_incidents
        WHERE monitor = ANY($1) AND (ended_at IS NULL OR started_at > now() - make_interval(days => $2))
        ORDER BY started_at DESC LIMIT 30`,
      [ids, DAYS]
    ),
  ])

  // The last DAYS calendar days in Amsterdam, oldest first.
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: ZONE }))
  const calendar = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1 - i))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  })

  const monitors = MONITORS.map(({ id }) => {
    const last = latest.rows.find((row) => row.monitor === id)
    const rows = days.rows.filter((row) => row.monitor === id)
    const total = rows.reduce((sum, row) => sum + row.total, 0)
    const ok = rows.reduce((sum, row) => sum + row.ok, 0)
    return {
      id,
      up: last ? last.ok : null,
      lastCheckAt: last?.checked_at.toISOString() ?? null,
      latencyMs: last?.latency_ms ?? null,
      uptime: total ? ok / total : null,
      days: calendar.map((day) => {
        const row = rows.find((r) => r.day === day)
        return { day, total: row?.total ?? 0, ok: row?.ok ?? 0 }
      }),
    }
  })

  const lastCheck = latest.rows.reduce<Date | null>((max, row) => (!max || row.checked_at > max ? row.checked_at : max), null)
  return {
    generatedAt: new Date().toISOString(),
    lastCheckAt: lastCheck?.toISOString() ?? null,
    monitors,
    incidents: incidents.rows.map((row) => ({
      monitor: row.monitor as StatusData["incidents"][number]["monitor"],
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at?.toISOString() ?? null,
      cause: row.cause,
    })),
  }
}

export async function GET() {
  try {
    return Response.json(await readStatus(), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("Status lezen mislukt", error)
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
