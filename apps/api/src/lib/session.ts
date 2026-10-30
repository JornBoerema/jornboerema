import { createMiddleware } from "hono/factory"
import { getAuth, type Session } from "@evido/auth/server"
import { env } from "../env"

export type AppEnv = { Variables: { session: Session } }

/** Requires a Better Auth session cookie (or bearer token for native apps). */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Log opnieuw in." }, 401)
  c.set("session", session)
  await next()
})

/** CSRF guard for cookie-authenticated writes: only known Evido front-ends. */
export const requireTrustedOrigin = createMiddleware(async (c, next) => {
  const origin = c.req.header("origin")
  if (!origin || !env.trustedOrigins.includes(origin))
    return c.json({ error: "Ongeldig verzoek." }, 403)
  await next()
})

export const noStore = { "Cache-Control": "private, no-store" }
