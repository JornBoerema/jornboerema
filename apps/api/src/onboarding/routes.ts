import { Hono } from "hono"
import { getDb } from "@even/db"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"

/** The first-run steps at /welcome: finished or skipped, they don't come back. */
export const onboardingRoutes = new Hono<AppEnv>()

onboardingRoutes.post("/done", requireTrustedOrigin, requireSession, async (c) => {
  const user = c.get("session").user
  await getDb().user.updateMany({ where: { id: user.id, onboardedAt: null }, data: { onboardedAt: new Date() } })
  return c.json({ ok: true }, 200, noStore)
})
