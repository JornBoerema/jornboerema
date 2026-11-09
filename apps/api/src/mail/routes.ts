import { Hono, type Context } from "hono"
import { getAuth } from "@evido/auth/server"
import { MissingScopeError, ReauthRequiredError } from "@evido/mail-core/provider"
import { isMailProvider, type ConnectErrorCode } from "@evido/mail-core/types"
import { env } from "../env"
import { msg } from "../i18n"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"
import {
  ConnectExpiredError,
  disconnectAccount,
  finishConnect,
  listAccounts,
  MailAccountNotFoundError,
  MailNotConfiguredError,
  readInboxSummary,
  startConnect,
} from "./accounts-server"
import { InvalidMessageCursorError, listMessages, syncAccount } from "./sync-server"

function failure(c: Context, error: unknown) {
  if (error instanceof MailAccountNotFoundError)
    return c.json({ error: msg(c, "mailAccountGone") }, 404)
  if (error instanceof ReauthRequiredError)
    return c.json({ error: msg(c, "mailReconnect"), reauth: true }, 409)
  if (error instanceof MailNotConfiguredError)
    return c.json({ error: msg(c, "mailNotConfigured") }, 503)
  console.error("Mail request failed", error instanceof Error ? error.message : "unknown")
  return c.json({ error: msg(c, "mailProviderFailed") }, 502)
}

export const mailRoutes = new Hono<AppEnv>()

mailRoutes.get("/accounts", requireSession, async (c) =>
  c.json({ accounts: await listAccounts(c.get("session").user.id) }, 200, noStore)
)

mailRoutes.post("/connect/:provider", requireTrustedOrigin, requireSession, async (c) => {
  const provider = c.req.param("provider")
  if (!isMailProvider(provider)) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json({ url: await startConnect(c.get("session").user.id, provider) }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Reached by a top-level redirect from the provider, so failures go back to the
// web app as a code in the URL instead of a JSON body nobody would see.
mailRoutes.get("/callback/:provider", async (c) => {
  const fail = (code: ConnectErrorCode) => c.redirect(`${env.mailWebUrl}/?error=${code}`)
  const provider = c.req.param("provider")
  const state = c.req.query("state")
  const code = c.req.query("code")
  if (c.req.query("error")) return fail("denied")
  if (!isMailProvider(provider) || !state || !code) return fail("failed")

  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return fail("session")
  try {
    await finishConnect(session.user.id, provider, state, code)
    return c.redirect(`${env.mailWebUrl}/?connected=1`)
  } catch (error) {
    if (error instanceof ConnectExpiredError) return fail("expired")
    if (error instanceof MissingScopeError) return fail("missing_scope")
    console.error("Mail connect failed", error instanceof Error ? error.message : "unknown")
    return fail("failed")
  }
})

mailRoutes.get("/accounts/:id/inbox", requireSession, async (c) => {
  try {
    const summary = await readInboxSummary(c.get("session").user.id, c.req.param("id"))
    return c.json(summary, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Called repeatedly by the client until `done`; each call does what fits in one function run.
mailRoutes.post("/accounts/:id/sync", requireTrustedOrigin, requireSession, async (c) => {
  try {
    return c.json(await syncAccount(c.get("session").user.id, c.req.param("id")), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/messages", requireSession, async (c) => {
  try {
    const page = await listMessages(c.get("session").user.id, {
      accountId: c.req.query("account"),
      cursor: c.req.query("cursor"),
    })
    return c.json(page, 200, noStore)
  } catch (error) {
    if (error instanceof InvalidMessageCursorError)
      return c.json({ error: msg(c, "invalidRequest") }, 400)
    return failure(c, error)
  }
})

mailRoutes.delete("/accounts/:id", requireTrustedOrigin, requireSession, async (c) => {
  try {
    await disconnectAccount(c.get("session").user.id, c.req.param("id"))
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})
