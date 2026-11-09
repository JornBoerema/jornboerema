import { Hono, type Context } from "hono"
import { z } from "zod"
import { getAuth } from "@evido/auth/server"
import { MissingScopeError, ProviderError, ReauthRequiredError } from "@evido/mail-core/provider"
import {
  isMailProvider,
  MAIL_THREAD_ACTIONS,
  MAX_UPLOAD_BYTES,
  type ConnectErrorCode,
} from "@evido/mail-core/types"
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
import { syncAccount } from "./sync-server"
import {
  actOnThread,
  forwardThread,
  InvalidThreadCursorError,
  listThreads,
  MailMessageNotFoundError,
  readAttachment,
  readThread,
  replyToThread,
  sendMessage,
} from "./threads-server"

const address = z.object({ name: z.string().max(200).nullable(), email: z.email().max(320) })
const recipients = z.array(address).max(100)
const text = z.string().max(100_000)
const attachments = z
  .array(
    z.object({
      name: z.string().min(1).max(255),
      contentType: z.string().max(200),
      data: z.base64(),
    })
  )
  .max(20)
  .refine((files) => files.reduce((sum, file) => sum + file.data.length, 0) * 0.75 <= MAX_UPLOAD_BYTES)
  .default([])
const actionBody = z.object({ action: z.enum(MAIL_THREAD_ACTIONS) })
const sendBody = z.object({
  to: recipients,
  cc: recipients,
  bcc: recipients,
  subject: z.string().max(900),
  text,
  attachments,
})
const replyBody = z.object({
  messageId: z.string().min(1).max(1000),
  to: recipients.min(1),
  cc: recipients,
  text: text.min(1),
  attachments,
})
const forwardBody = z.object({
  messageId: z.string().min(1).max(1000),
  to: recipients.min(1),
  cc: recipients,
  text,
})
const attachmentBody = z.object({
  messageId: z.string().min(1).max(1000),
  attachmentId: z.string().min(1).max(4000),
})

async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

function failure(c: Context, error: unknown) {
  if (error instanceof MailAccountNotFoundError)
    return c.json({ error: msg(c, "mailAccountGone") }, 404)
  if (
    error instanceof MailMessageNotFoundError ||
    (error instanceof ProviderError && error.status === 404)
  )
    return c.json({ error: msg(c, "mailMessageGone") }, 404)
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

mailRoutes.get("/threads", requireSession, async (c) => {
  try {
    const page = await listThreads(c.get("session").user.id, {
      accountId: c.req.query("account"),
      cursor: c.req.query("cursor"),
    })
    return c.json(page, 200, noStore)
  } catch (error) {
    if (error instanceof InvalidThreadCursorError)
      return c.json({ error: msg(c, "invalidRequest") }, 400)
    return failure(c, error)
  }
})

// Mail bodies pass through on request and are never written anywhere.
mailRoutes.get("/threads/:id", requireSession, async (c) => {
  try {
    return c.json(await readThread(c.get("session").user.id, c.req.param("id")), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/threads/:id/actions", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, actionBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await actOnThread(c.get("session").user.id, c.req.param("id"), body.action)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/threads/:id/reply", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, replyBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await replyToThread(c.get("session").user.id, c.req.param("id"), body)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/threads/:id/forward", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, forwardBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await forwardThread(c.get("session").user.id, c.req.param("id"), body)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// POST because provider ids can outgrow a URL. Always a download, never rendered:
// the file comes from a stranger and must not run on this origin.
mailRoutes.post("/threads/:id/attachment", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, attachmentBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const bytes = await readAttachment(c.get("session").user.id, c.req.param("id"), body)
    // Streamed, because Vercel caps buffered responses at 4.5 MB.
    return new Response(new Blob([bytes as BlobPart]).stream(), {
      headers: {
        ...noStore,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/send", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, sendBody)
  if (!body || body.to.length + body.cc.length + body.bcc.length === 0)
    return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await sendMessage(c.get("session").user.id, c.req.param("id"), body)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
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
