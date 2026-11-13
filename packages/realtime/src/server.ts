import { createRealtime, rawSql, type RealtimeServer, type SealedLiveQuery } from "@neon/realtime/server"
import { getDb } from "@evido/db"

/**
 * Realtime over Neon: every change bumps a row in `realtime_pings`, and each
 * client holds a live query on its own channel's row. The row carries no app
 * data, only a counter; clients refetch through the API when it moves.
 */
export type PingRow = { version: string }
export type RealtimeSubscription = { url: string; query: SealedLiveQuery<PingRow> }

export const userChannel = (userId: string) => `workspace:${userId}`
export const mailChannel = (userId: string) => `mail:${userId}`

export function realtimeEnabled() {
  return !!(process.env.NEON_REALTIME_SECRET && process.env.NEON_REALTIME_URL)
}

let server: RealtimeServer<unknown> | undefined
function getServer() {
  const secret = process.env.NEON_REALTIME_SECRET
  if (!secret) throw new Error("NEON_REALTIME_SECRET ontbreekt.")
  // The database the live queries run in: the one DATABASE_URL points at.
  const db = process.env.NEON_REALTIME_DB || new URL(process.env.DATABASE_URL ?? "postgres://localhost/neondb").pathname.slice(1) || "neondb"
  return (server ??= createRealtime({ secret, db }))
}

/** A short-lived (60 s) capability to watch one channel; the client renews it. */
export async function sealChannel(channel: string): Promise<RealtimeSubscription> {
  const query = await getServer().seal({
    query: rawSql<PingRow>("SELECT version::text AS version FROM realtime_pings WHERE channel = $1", [channel]),
  })
  return { url: process.env.NEON_REALTIME_URL!, query }
}

/** Tells every client on these channels to refetch. Never throws: clients also catch up on reconnect. */
export async function ping(channels: string[]) {
  if (!realtimeEnabled()) return
  const unique = [...new Set(channels)]
  if (!unique.length) return
  try {
    await getDb().$executeRaw`
      INSERT INTO realtime_pings (channel, version, updated_at)
      SELECT channel, 1, now() FROM unnest(${unique}::text[]) AS channel
      ON CONFLICT (channel) DO UPDATE SET version = realtime_pings.version + 1, updated_at = now()`
  } catch (error) {
    console.error("Realtime ping failed; clients will catch up on reconnect.", error)
  }
}
