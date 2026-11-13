import { randomUUID } from "node:crypto"
import { getDb } from "@evido/db"

/**
 * Counts one more use of `key` in its current window and says whether that is
 * over `max`. Kept in the database, so every function instance counts together.
 */
export async function overLimit(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const windowStart = now - windowMs
  const [row] = await getDb().$queryRaw<{ count: number }[]>`
    insert into rate_limit (id, key, count, last_request)
    values (${randomUUID()}, ${key}, 1, ${now})
    on conflict (key) do update set
      count = case when rate_limit.last_request < ${windowStart} then 1 else rate_limit.count + 1 end,
      last_request = case when rate_limit.last_request < ${windowStart} then ${now} else rate_limit.last_request end
    returning count`
  return (row?.count ?? 0) > max
}

/** Too many of something in a short time. `message` is a key of the API's messages. */
export class TooManyError extends Error {
  constructor(readonly messageKey: "mailSendLimit" | "aiTooFast") {
    super(messageKey)
  }
}
