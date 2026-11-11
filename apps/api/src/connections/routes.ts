import { Hono, type Context } from "hono"
import { z } from "zod"
import { getAuth } from "@evido/auth/server"
import type { ConnectionErrorCode } from "@evido/mail-core/connections"
import { env } from "../env"
import { msg } from "../i18n"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"
import {
  AdministrationNotFoundError,
  ConnectionExpiredError,
  ConnectionNotFoundError,
  disconnectMoneybird,
  finishMoneybirdConnect,
  listConnections,
  setDefaultAdministration,
  startMoneybirdConnect,
} from "./connections-server"
import { MoneybirdError, MoneybirdNotConfiguredError, MoneybirdReauthError } from "./moneybird"

/** Errors from connections, for these routes and for mail handing things to them. */
export function connectionFailure(c: Context, error: unknown) {
  if (error instanceof ConnectionNotFoundError) return c.json({ error: msg(c, "connectionGone"), connect: true }, 404)
  if (error instanceof AdministrationNotFoundError) return c.json({ error: msg(c, "administrationGone") }, 404)
  if (error instanceof MoneybirdNotConfiguredError) return c.json({ error: msg(c, "moneybirdNotConfigured") }, 503)
  if (error instanceof MoneybirdReauthError) return c.json({ error: msg(c, "moneybirdReconnect"), connect: true }, 409)
  if (error instanceof MoneybirdError && error.status === 429) return c.json({ error: msg(c, "moneybirdBusy") }, 429)
  if (error instanceof MoneybirdError && (error.status === 403 || error.status === 404))
    return c.json({ error: msg(c, "administrationGone") }, 404)
  return null
}

function failed(c: Context, error: unknown) {
  const known = connectionFailure(c, error)
  if (known) return known
  console.error("Connection request failed", error instanceof Error ? error.message : "unknown")
  return c.json({ error: msg(c, "moneybirdFailed") }, 502)
}

export const connectionRoutes = new Hono<AppEnv>()

connectionRoutes.get("/", requireSession, async (c) =>
  c.json(await listConnections(c.get("session").user.id), 200, noStore)
)

connectionRoutes.post("/moneybird/connect", requireTrustedOrigin, requireSession, async (c) => {
  try {
    return c.json({ url: await startMoneybirdConnect(c.get("session").user.id) }, 200, noStore)
  } catch (error) {
    return failed(c, error)
  }
})

// Reached by a top-level redirect from Moneybird, so failures go back to the
// mail app as a code in the URL, which its settings show.
connectionRoutes.get("/moneybird/callback", async (c) => {
  const back = (result: string) => c.redirect(`${env.mailWebUrl}/?settings=connections&${result}`)
  const fail = (code: ConnectionErrorCode) => back(`connection_error=${code}`)
  const state = c.req.query("state")
  const code = c.req.query("code")
  if (c.req.query("error")) return fail("denied")
  if (!state || !code) return fail("failed")
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return fail("session")
  try {
    await finishMoneybirdConnect(session.user.id, state, code)
    return back("connected=moneybird")
  } catch (error) {
    if (error instanceof ConnectionExpiredError) return fail("expired")
    if (error instanceof MoneybirdNotConfiguredError) return fail("not_configured")
    console.error("Moneybird connect failed", error instanceof Error ? error.message : "unknown")
    return fail("failed")
  }
})

const defaultBody = z.object({ administrationId: z.string().regex(/^\d{1,30}$/).nullable() })

connectionRoutes.patch("/moneybird", requireTrustedOrigin, requireSession, async (c) => {
  const body = defaultBody.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await setDefaultAdministration(c.get("session").user.id, body.data.administrationId)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failed(c, error)
  }
})

connectionRoutes.delete("/moneybird", requireTrustedOrigin, requireSession, async (c) => {
  try {
    await disconnectMoneybird(c.get("session").user.id)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failed(c, error)
  }
})
