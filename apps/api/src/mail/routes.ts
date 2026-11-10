import { Hono, type Context } from "hono"
import { z } from "zod"
import { getAuth } from "@evido/auth/server"
import { isRateLimited, MissingScopeError, ProviderError, ReauthRequiredError } from "@evido/mail-core/provider"
import {
  isMailFolder,
  isMailProvider,
  MAIL_THREAD_ACTIONS,
  MAX_UPLOAD_BYTES,
  type ConnectErrorCode,
  MAIL_ACCOUNT_COLORS,
  MAX_SIGNATURE_LENGTH,
  MAX_SEARCH_LENGTH,
  INLINE_CONTENT_ID,
  isDraftWorthKeeping,
} from "@evido/mail-core/types"
import { env } from "../env"
import { msg } from "../i18n"
import { defer } from "../lib/defer"
import { getRealtime, mailChannel } from "../lib/realtime"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"
import {
  ConnectExpiredError,
  disconnectAccount,
  finishConnect,
  listAccounts,
  MailAccountNotFoundError,
  MailNotConfiguredError,
  MailSignatureNotFoundError,
  readInboxSummary,
  updateAccountSettings,
  startConnect,
} from "./accounts-server"
import { deleteDraft, listDrafts, readDraft, saveDraft, sendDraft } from "./drafts-server"
import {
  createSignature,
  deleteSignature,
  listSignatures,
  TooManySignaturesError,
  updateSignature,
} from "./signatures-server"
import { syncAccount } from "./sync-server"
import {
  authorizeCron,
  authorizeGmailWebhook,
  ensureWatch,
  handleGmailNotification,
  handleOutlookNotifications,
  renewWatches,
} from "./webhooks-server"
import {
  actOnConversation,
  attachmentInConversation,
  forwardFromConversation,
  ownedConversation,
  readConversation,
  replyInConversation,
  quickSearch,
  suggestContacts,
  unreadSummary,
  searchMail,
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
const html = z.string().max(500_000).optional()
const attachments = z
  .array(
    z.object({
      name: z.string().min(1).max(255),
      contentType: z.string().max(200),
      data: z.base64(),
    })
  )
  .max(20)
  .default([])
const inline = z
  .array(
    z.object({
      contentId: z.string().regex(INLINE_CONTENT_ID),
      name: z.string().min(1).max(255),
      contentType: z.string().regex(/^image\/[\w.+-]+$/),
      data: z.base64(),
    })
  )
  .max(50)
  .optional()
type Files = { attachments?: { data: string }[]; inline?: { data: string }[] }
/** Files and inline images together, as decoded bytes. */
const fitsUpload = (body: Files) =>
  [...(body.attachments ?? []), ...(body.inline ?? [])].reduce((sum, file) => sum + file.data.length, 0) * 0.75 <=
  MAX_UPLOAD_BYTES
const signatureId = z.string().min(1).max(100).nullable().optional()
const accountBody = z
  .object({
    color: z.number().int().min(0).lt(MAIL_ACCOUNT_COLORS).optional(),
    signatureNewId: signatureId,
    signatureReplyId: signatureId,
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined))
const signatureName = z.string().trim().min(1).max(100)
const signatureHtml = z.string().max(MAX_SIGNATURE_LENGTH)
const newSignatureBody = z.object({ name: signatureName, html: signatureHtml })
const signatureBody = z
  .object({ name: signatureName.optional(), html: signatureHtml.optional() })
  .refine((body) => body.name !== undefined || body.html !== undefined)
const actionBody = z.object({ action: z.enum(MAIL_THREAD_ACTIONS) })
const sendFields = z.object({
  to: recipients,
  cc: recipients,
  bcc: recipients,
  subject: z.string().max(900),
  text,
  html,
  attachments,
  inline,
})
const sendBody = sendFields.refine(fitsUpload)
const providerId = z.string().min(1).max(1000)
const draftBody = sendFields.extend({
  draftId: providerId.nullable(),
  attachmentsChanged: z.boolean(),
  reply: z
    .object({
      threadId: providerId,
      inReplyTo: z.string().max(2000).optional(),
      references: z.string().max(20_000).optional(),
    })
    .optional(),
}).refine(fitsUpload)
const replyBody = z.object({
  messageId: z.string().min(1).max(1000),
  to: recipients.min(1),
  cc: recipients,
  text: text.min(1),
  html,
  attachments,
  inline,
}).refine(fitsUpload)
const forwardBody = z.object({
  messageId: z.string().min(1).max(1000),
  to: recipients.min(1),
  cc: recipients,
  text,
  html,
  inline,
}).refine(fitsUpload)
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
  if (error instanceof MailSignatureNotFoundError)
    return c.json({ error: msg(c, "mailSignatureGone") }, 404)
  if (error instanceof TooManySignaturesError)
    return c.json({ error: msg(c, "mailTooManySignatures") }, 409)
  if (
    error instanceof MailMessageNotFoundError ||
    (error instanceof ProviderError && error.status === 404)
  )
    return c.json({ error: msg(c, "mailMessageGone") }, 404)
  if (error instanceof ReauthRequiredError)
    return c.json({ error: msg(c, "mailReconnect"), reauth: true }, 409)
  if (error instanceof MailNotConfiguredError)
    return c.json({ error: msg(c, "mailNotConfigured") }, 503)
  // Still refused after trying again: nothing happened, so trying later is safe.
  if (isRateLimited(error)) return c.json({ error: msg(c, "mailBusy") }, 429)
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
    const account = await finishConnect(session.user.id, provider, state, code)
    defer(() => ensureWatch(account))
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
    const folder = c.req.query("folder")
    if (folder !== undefined && !isMailFolder(folder)) return c.json({ error: msg(c, "invalidRequest") }, 400)
    const page = await listThreads(c.get("session").user.id, {
      accountId: c.req.query("account"),
      cursor: c.req.query("cursor"),
      folder,
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

mailRoutes.get("/drafts", requireSession, async (c) =>
  c.json(await listDrafts(c.get("session").user.id), 200, noStore)
)

// Like mail bodies, drafts pass through and are never written here.
mailRoutes.get("/accounts/:id/drafts/:draftId", requireSession, async (c) => {
  try {
    const draft = await readDraft(c.get("session").user.id, c.req.param("id"), c.req.param("draftId"))
    return c.json(draft, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/drafts", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, draftBody)
  if (!body || !isDraftWorthKeeping(body)) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json(await saveDraft(c.get("session").user.id, c.req.param("id"), body), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/drafts/:draftId/send", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, draftBody)
  if (!body || body.to.length + body.cc.length + body.bcc.length === 0)
    return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const draftId = c.req.param("draftId")
    await sendDraft(c.get("session").user.id, c.req.param("id"), { ...body, draftId })
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.delete("/accounts/:id/drafts/:draftId", requireTrustedOrigin, requireSession, async (c) => {
  try {
    await deleteDraft(c.get("session").user.id, c.req.param("id"), c.req.param("draftId"))
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/signatures", requireSession, async (c) =>
  c.json({ signatures: await listSignatures(c.get("session").user.id) }, 200, noStore)
)

mailRoutes.post("/signatures", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, newSignatureBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json(await createSignature(c.get("session").user.id, body), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.patch("/signatures/:id", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, signatureBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await updateSignature(c.get("session").user.id, c.req.param("id"), body)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.delete("/signatures/:id", requireTrustedOrigin, requireSession, async (c) => {
  try {
    await deleteSignature(c.get("session").user.id, c.req.param("id"))
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/unread", requireSession, async (c) =>
  c.json(await unreadSummary(c.get("session").user.id), 200, noStore)
)

mailRoutes.get("/contacts", requireSession, async (c) => {
  const query = c.req.query("q") ?? ""
  if (query.length > 200) return c.json({ error: msg(c, "invalidRequest") }, 400)
  return c.json({ contacts: await suggestContacts(c.get("session").user.id, query) }, 200, noStore)
})

mailRoutes.get("/search/quick", requireSession, async (c) => {
  const query = c.req.query("q")?.trim() ?? ""
  if (!query || query.length > MAX_SEARCH_LENGTH) return c.json({ error: msg(c, "invalidRequest") }, 400)
  return c.json({ hits: await quickSearch(c.get("session").user.id, query) }, 200, noStore)
})

mailRoutes.get("/search", requireSession, async (c) => {
  const query = c.req.query("q")?.trim() ?? ""
  if (!query || query.length > MAX_SEARCH_LENGTH) return c.json({ error: msg(c, "invalidRequest") }, 400)
  return c.json(await searchMail(c.get("session").user.id, query), 200, noStore)
})

// A conversation by provider id, for ones search found outside the synced inbox.
// The id goes in the query string: Graph ids contain "/" and "=".
const conversationId = z.string().min(1).max(1000)
async function conversationOf(c: Context<AppEnv>) {
  const threadId = conversationId.safeParse(c.req.query("thread"))
  if (!threadId.success) return null
  return ownedConversation(c.get("session").user.id, c.req.param("id") ?? "", threadId.data)
}

mailRoutes.get("/accounts/:id/conversation", requireSession, async (c) => {
  try {
    const conversation = await conversationOf(c)
    if (!conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    // Spam and trash only show when the conversation is opened from those folders.
    const includeHidden = c.req.query("hidden") === "1"
    return c.json(await readConversation(conversation, { includeHidden }), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/conversation/actions", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, actionBody)
  try {
    const conversation = await conversationOf(c)
    if (!body || !conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    await actOnConversation(conversation, body.action)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/conversation/reply", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, replyBody)
  try {
    const conversation = await conversationOf(c)
    if (!body || !conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    await replyInConversation(conversation, body)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/conversation/forward", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, forwardBody)
  try {
    const conversation = await conversationOf(c)
    if (!body || !conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    await forwardFromConversation(conversation, body)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Same as the thread attachment route: always a download, never rendered.
mailRoutes.post("/accounts/:id/conversation/attachment", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, attachmentBody)
  try {
    const conversation = await conversationOf(c)
    if (!body || !conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    const bytes = await attachmentInConversation(conversation, body)
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

mailRoutes.get("/realtime", requireSession, async (c) => {
  if (!process.env.ABLY_API_KEY) return c.json({ error: msg(c, "realtimeUnavailable") }, 503)
  const userId = c.get("session").user.id
  const token = await getRealtime().auth.createTokenRequest({
    clientId: userId,
    capability: JSON.stringify({ [mailChannel(userId)]: ["subscribe"] }),
    ttl: 15 * 60 * 1000,
  })
  return c.json(token, 200, noStore)
})

// Microsoft needs an answer within 3 seconds, so the work happens after responding.
mailRoutes.post("/webhook/outlook", async (c) => {
  const validationToken = c.req.query("validationToken")
  if (validationToken) return c.text(validationToken)
  const body: unknown = await c.req.json().catch(() => null)
  defer(() => handleOutlookNotifications(body))
  return c.body(null, 202)
})

mailRoutes.post("/webhook/gmail", async (c) => {
  if (!authorizeGmailWebhook(c.req.query("token"))) return c.body(null, 401)
  const body: unknown = await c.req.json().catch(() => null)
  defer(() => handleGmailNotification(body))
  return c.body(null, 204)
})

mailRoutes.get("/cron/watches", async (c) => {
  if (!authorizeCron(c.req.header("authorization"))) return c.body(null, 401)
  return c.json(await renewWatches(), 200, noStore)
})

mailRoutes.patch("/accounts/:id", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, accountBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    await updateAccountSettings(c.get("session").user.id, c.req.param("id"), body)
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
