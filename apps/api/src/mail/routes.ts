import { Hono, type Context } from "hono"
import { z } from "zod"
import { getAuth } from "@evido/auth/server"
import {
  isRateLimited,
  MissingScopeError,
  ProviderError,
  ReauthRequiredError,
  UnsupportedActionError,
} from "@evido/mail-core/provider"
import {
  isMailFolder,
  isMailProvider,
  MAIL_THREAD_ACTIONS,
  MAX_ATTACHMENTS_BYTES,
  MAX_UPLOAD_BYTES,
  type ConnectErrorCode,
  MAIL_ACCOUNT_COLORS,
  MAX_SIGNATURE_LENGTH,
  MAX_SEARCH_LENGTH,
  UPLOAD_CHUNK_BYTES,
  INLINE_CONTENT_ID,
  isDraftWorthKeeping,
} from "@evido/mail-core/types"
import { env } from "../env"
import { languageOf, msg } from "../i18n"
import { defer } from "../lib/defer"
import { actOnSender, listSenders, senderConversations } from "./senders-server"
import { getRealtime, mailChannel } from "../lib/realtime"
import { every } from "hono/combine"
import { requireAppAccess } from "../lib/access"
import { noStore, requireSession as signedIn, requireTrustedOrigin, type AppEnv } from "../lib/session"

/** Signed in, and let into Even mailen: it is invite-only for now. */
const requireSession = every(signedIn, requireAppAccess("mail"))
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
import { summaryFor, SummaryFailedError } from "./summary-server"
import { listShipments, scanShipments, shipmentForConversation } from "./shipments-server"
import { NothingToUnsubscribeError, unsubscribeFrom } from "./unsubscribe-server"
import {
  cancelScheduled,
  catchUp,
  listScheduled,
  listSnoozes,
  runJob,
  scheduleSend,
  sendScheduledNow,
  snooze,
  unsnooze,
} from "./later-server"
import { secretsMatch } from "@evido/mail-core/secrets"
import type { Conversation } from "./threads-server"
import { streamMessage, WriteFailedError, WriteNotConfiguredError, type WriteRequest } from "./write-server"
import { invoicesEnabled, parcelsEnabled, readPreferences, savePreferences } from "./preferences-server"
import { invoiceForConversation, listInvoices, scanInvoices } from "./invoices-server"
import { syncAccount } from "./sync-server"
import {
  createUpload,
  deleteUploads,
  dropOldUploads,
  loadAttachments,
  putChunk,
  storeAsUpload,
  UploadIncompleteError,
  UploadNotFoundError,
  UploadTooLargeError,
} from "./uploads-server"
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
  emptyTrash,
  ownedMessage,
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
// Files are uploaded in chunks first; a message refers to them by id.
const attachments = z
  .array(
    z.object({
      uploadId: z.uuid(),
      name: z.string().min(1).max(255),
      contentType: z.string().max(200),
      size: z.number().int().min(0).max(MAX_ATTACHMENTS_BYTES),
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
type Files = { attachments?: { size: number }[]; inline?: { data: string }[] }
/** Inline pictures travel in the request and stay small; files add up to Gmail's limit. */
const fitsUpload = (body: Files) =>
  (body.inline ?? []).reduce((sum, file) => sum + file.data.length, 0) * 0.75 <= MAX_UPLOAD_BYTES &&
  (body.attachments ?? []).reduce((sum, file) => sum + file.size, 0) <= MAX_ATTACHMENTS_BYTES
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
  if (error instanceof UploadTooLargeError) return c.json({ error: msg(c, "attachmentsTooLarge") }, 413)
  if (error instanceof UploadNotFoundError || error instanceof UploadIncompleteError)
    return c.json({ error: msg(c, "attachmentMissing") }, 400)
  if (error instanceof UnsupportedActionError) return c.json({ error: msg(c, "mailCantDeleteForever") }, 400)
  // Still refused after trying again: nothing happened, so trying later is safe.
  if (isRateLimited(error)) return c.json({ error: msg(c, "mailBusy") }, 429)
  console.error("Mail request failed", error instanceof Error ? error.message : "unknown")
  return c.json({ error: msg(c, "mailProviderFailed") }, 502)
}

export const mailRoutes = new Hono<AppEnv>()

const preferencesBody = z
  .object({
    summaries: z.boolean(),
    codes: z.boolean(),
    aiWriting: z.boolean(),
    remoteImages: z.boolean(),
    parcels: z.boolean(),
    unsubscribe: z.boolean(),
    senders: z.boolean(),
    invoices: z.boolean(),
  })
  .partial()
  .refine((change) => Object.keys(change).length > 0)

// Settings that follow the account to every device.
mailRoutes.get("/preferences", requireSession, async (c) =>
  c.json({ preferences: await readPreferences(c.get("session").user.id) }, 200, noStore)
)

mailRoutes.patch("/preferences", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, preferencesBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  return c.json({ preferences: await savePreferences(c.get("session").user.id, body) }, 200, noStore)
})

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
    const userId = c.get("session").user.id
    const page = await listThreads(userId, {
      accountId: c.req.query("account"),
      cursor: c.req.query("cursor"),
      folder,
    })
    // Snoozes and scheduled mail whose moment passed unnoticed are done now, after answering.
    if (!c.req.query("cursor")) defer(() => catchUp(userId))
    return c.json(page, 200, noStore)
  } catch (error) {
    if (error instanceof InvalidThreadCursorError)
      return c.json({ error: msg(c, "invalidRequest") }, 400)
    return failure(c, error)
  }
})

const writeBody = z.object({
  instruction: z.string().trim().min(1).max(2000),
  draft: z.string().max(20_000).default(""),
  subject: z.string().max(500).default(""),
  hasSignature: z.boolean().default(false),
  forward: z.boolean().default(false),
})

function writeFailure(c: Context, error: unknown) {
  if (error instanceof WriteNotConfiguredError) return c.json({ error: msg(c, "writeUnavailable") }, 503)
  if (error instanceof WriteFailedError) return c.json({ error: msg(c, "writeFailed") }, 502)
  return failure(c, error)
}

const writeRequest = (c: Context<AppEnv>, body: z.infer<typeof writeBody>): WriteRequest => ({
  ...body,
  senderName: c.get("session").user.name ?? "",
})

/** Plain text as it is written, never buffered on the way. */
const streamed = (c: Context, stream: ReadableStream<Uint8Array>) =>
  c.body(stream, 200, { ...noStore, "Content-Type": "text/plain; charset=utf-8", "X-Accel-Buffering": "no" })

// Sent to a language model on request only; neither the instruction nor the answer is kept.
mailRoutes.post("/write", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, writeBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return streamed(c, await streamMessage(writeRequest(c, body), { language: languageOf(c) }))
  } catch (error) {
    return writeFailure(c, error)
  }
})

mailRoutes.post("/threads/:id/write", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, writeBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const conversation = await ownedMessage(c.get("session").user.id, c.req.param("id"))
    const { messages } = await readConversation(conversation, { includeHidden: conversation.hidden })
    return streamed(c, await streamMessage(writeRequest(c, body), { language: languageOf(c), conversation: messages }))
  } catch (error) {
    return writeFailure(c, error)
  }
})

// Mail bodies pass through on request and are never written anywhere.
// Read live, summed up, and not kept: the summary goes to the reader only.
const summaryOptions = (c: Context) => ({
  useModel: c.req.query("ai") !== "0",
  findCodes: c.req.query("codes") !== "0",
})

// Made once per newest message and kept; the mail itself isn't.
mailRoutes.get("/threads/:id/summary", requireSession, async (c) => {
  try {
    const conversation = await ownedMessage(c.get("session").user.id, c.req.param("id"))
    return c.json(await summaryFor(conversation, languageOf(c), summaryOptions(c)), 200, noStore)
  } catch (error) {
    if (error instanceof SummaryFailedError) return c.json({ error: msg(c, "summaryFailed") }, 502)
    return failure(c, error)
  }
})

// Parcels: carrier, tracking code and link, and status are kept; the mail isn't.
// Opening the list first reads shipping mail it hasn't seen, within a time budget.
mailRoutes.get("/shipments", requireSession, async (c) => {
  try {
    const userId = c.get("session").user.id
    // Turned off: no shipping mail is read.
    if (!(await parcelsEnabled(userId))) return c.json({ shipments: [], complete: true }, 200, noStore)
    const scan = await scanShipments(userId)
    return c.json({ shipments: await listShipments(userId), complete: scan.done }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Invoices: who, how much, by when and whether paid are kept; the mail isn't.
mailRoutes.get("/invoices", requireSession, async (c) => {
  try {
    const userId = c.get("session").user.id
    if (!(await invoicesEnabled(userId))) return c.json({ invoices: [], complete: true }, 200, noStore)
    const scan = await scanInvoices(userId)
    return c.json({ invoices: await listInvoices(userId), complete: scan.done }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/threads/:id/invoice", requireSession, async (c) => {
  try {
    const userId = c.get("session").user.id
    if (!(await invoicesEnabled(userId))) return c.json({ invoice: null }, 200, noStore)
    return c.json({ invoice: await invoiceForConversation(await ownedMessage(userId, c.req.param("id"))) }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/accounts/:id/conversation/invoice", requireSession, async (c) => {
  try {
    if (!(await invoicesEnabled(c.get("session").user.id))) return c.json({ invoice: null }, 200, noStore)
    const conversation = await conversationOf(c)
    if (!conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    const hidden = c.req.query("hidden") === "1"
    return c.json({ invoice: await invoiceForConversation({ ...conversation, hidden }) }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/threads/:id/shipment", requireSession, async (c) => {
  try {
    const userId = c.get("session").user.id
    if (!(await parcelsEnabled(userId))) return c.json({ shipment: null }, 200, noStore)
    const conversation = await ownedMessage(userId, c.req.param("id"))
    return c.json({ shipment: await shipmentForConversation(conversation) }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Unsubscribing: the browser names the message; its headers are read here, from the provider.
const unsubscribeBody = z.object({ messageId: z.string().min(1).max(1000) })

const unsubscribed = async (c: Context, conversation: Conversation | null) => {
  const body = await readBody(c, unsubscribeBody)
  if (!body || !conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json(await unsubscribeFrom(conversation, body.messageId), 200, noStore)
  } catch (error) {
    if (error instanceof NothingToUnsubscribeError) return c.json({ error: msg(c, "invalidRequest") }, 400)
    return failure(c, error)
  }
}

mailRoutes.post("/threads/:id/unsubscribe", requireTrustedOrigin, requireSession, async (c) => {
  try {
    return await unsubscribed(c, await ownedMessage(c.get("session").user.id, c.req.param("id")))
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/conversation/unsubscribe", requireTrustedOrigin, requireSession, async (c) => {
  try {
    const conversation = await conversationOf(c)
    return await unsubscribed(c, conversation && { ...conversation, hidden: c.req.query("hidden") === "1" })
  } catch (error) {
    return failure(c, error)
  }
})

// Tidying up per sender: who fills the inbox, and everything from them at once.
mailRoutes.get("/senders", requireSession, async (c) =>
  c.json({ senders: await listSenders(c.get("session").user.id, c.req.query("account") || undefined) }, 200, noStore)
)

mailRoutes.get("/senders/conversations", requireSession, async (c) => {
  const email = z.email().max(320).safeParse(c.req.query("email"))
  if (!email.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  const threads = await senderConversations(c.get("session").user.id, email.data, c.req.query("account") || undefined)
  return c.json({ threads }, 200, noStore)
})

const senderBody = z.object({
  email: z.email().max(320),
  action: z.enum(["archive", "read", "trash"]),
  account: z.string().min(1).max(100).optional(),
})

// One round: as much as fits in the time budget. The app calls again while some remain.
mailRoutes.post("/senders/action", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, senderBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json(await actOnSender(c.get("session").user.id, body.email, body.action, body.account), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Snoozing and sending later. A moment must lie ahead, within two years.
const moment = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine((date) => date.getTime() > Date.now() - 60_000 && date.getTime() < Date.now() + 2 * 365 * 86_400_000)
const snoozeBody = z.object({ until: moment })

mailRoutes.get("/snoozes", requireSession, async (c) =>
  c.json(await listSnoozes(c.get("session").user.id), 200, noStore)
)

mailRoutes.post("/threads/:id/snooze", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, snoozeBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const conversation = await ownedMessage(c.get("session").user.id, c.req.param("id"))
    return c.json(await snooze(conversation, body.until), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.delete("/threads/:id/snooze", requireTrustedOrigin, requireSession, async (c) => {
  try {
    await unsnooze(await ownedMessage(c.get("session").user.id, c.req.param("id")))
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/scheduled", requireSession, async (c) =>
  c.json({ scheduled: await listScheduled(c.get("session").user.id) }, 200, noStore)
)

mailRoutes.post("/accounts/:id/scheduled", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, draftBody.extend({ sendAt: moment }))
  if (!body || body.to.length + body.cc.length + body.bcc.length === 0)
    return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const userId = c.get("session").user.id
    const { sendAt, ...draft } = body
    const files = await loadAttachments(userId, draft.attachments)
    return c.json(await scheduleSend(userId, c.req.param("id"), { ...draft, attachments: files }, sendAt), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.delete("/scheduled/:id", requireTrustedOrigin, requireSession, async (c) => {
  try {
    return c.json(await cancelScheduled(c.get("session").user.id, c.req.param("id")), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/scheduled/:id/send", requireTrustedOrigin, requireSession, async (c) => {
  try {
    await sendScheduledNow(c.get("session").user.id, c.req.param("id"))
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Trigger.dev knocks here at a job's moment, with the shared secret.
const jobBody = z.object({ kind: z.enum(["snooze", "send"]), id: z.uuid() })
mailRoutes.post("/jobs/run", async (c) => {
  const secret = process.env.MAIL_JOBS_SECRET
  const header = c.req.header("authorization")
  if (!secret || !header || !secretsMatch(header, `Bearer ${secret}`)) return c.body(null, 401)
  const body = await readBody(c, jobBody)
  if (!body) return c.json({ error: "invalid job" }, 400)
  return c.json({ done: await runJob(body) }, 200, noStore)
})

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
    const userId = c.get("session").user.id
    await replyToThread(userId, c.req.param("id"), { ...body, attachments: await loadAttachments(userId, body.attachments) })
    await deleteUploads(userId, body.attachments.map((file) => file.uploadId))
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
    const userId = c.get("session").user.id
    await sendMessage(userId, c.req.param("id"), { ...body, attachments: await loadAttachments(userId, body.attachments) })
    await deleteUploads(userId, body.attachments.map((file) => file.uploadId))
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
    const userId = c.get("session").user.id
    const saved = await readDraft(userId, c.req.param("id"), c.req.param("draftId"))
    // Its files become uploads, so the client refers to them like freshly attached ones.
    const draft = { ...saved, attachments: await Promise.all(saved.attachments.map((file) => storeAsUpload(userId, file))) }
    return c.json(draft, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/drafts", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, draftBody)
  if (!body || !isDraftWorthKeeping(body)) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const userId = c.get("session").user.id
    const files = await loadAttachments(userId, body.attachments)
    return c.json(await saveDraft(userId, c.req.param("id"), { ...body, attachments: files }), 200, noStore)
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
    const userId = c.get("session").user.id
    const files = await loadAttachments(userId, body.attachments)
    await sendDraft(userId, c.req.param("id"), { ...body, attachments: files, draftId })
    await deleteUploads(userId, body.attachments.map((file) => file.uploadId))
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

mailRoutes.get("/accounts/:id/conversation/shipment", requireSession, async (c) => {
  try {
    if (!(await parcelsEnabled(c.get("session").user.id))) return c.json({ shipment: null }, 200, noStore)
    const conversation = await conversationOf(c)
    if (!conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    const hidden = c.req.query("hidden") === "1"
    return c.json({ shipment: await shipmentForConversation({ ...conversation, hidden }) }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.get("/accounts/:id/conversation/summary", requireSession, async (c) => {
  try {
    const conversation = await conversationOf(c)
    if (!conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    const hidden = c.req.query("hidden") === "1"
    return c.json(await summaryFor({ ...conversation, hidden }, languageOf(c), summaryOptions(c)), 200, noStore)
  } catch (error) {
    if (error instanceof SummaryFailedError) return c.json({ error: msg(c, "summaryFailed") }, 502)
    return failure(c, error)
  }
})

mailRoutes.post("/accounts/:id/conversation/write", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, writeBody)
  try {
    const conversation = await conversationOf(c)
    if (!body || !conversation) return c.json({ error: msg(c, "invalidRequest") }, 400)
    const { messages } = await readConversation(conversation, { includeHidden: c.req.query("hidden") === "1" })
    return streamed(c, await streamMessage(writeRequest(c, body), { language: languageOf(c), conversation: messages }))
  } catch (error) {
    return writeFailure(c, error)
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
    const userId = c.get("session").user.id
    await replyInConversation(conversation, { ...body, attachments: await loadAttachments(userId, body.attachments) })
    await deleteUploads(userId, body.attachments.map((file) => file.uploadId))
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

// Called until `done`: each call deletes one page for good.
mailRoutes.post("/accounts/:id/trash/empty", requireTrustedOrigin, requireSession, async (c) => {
  try {
    return c.json(await emptyTrash(c.get("session").user.id, c.req.param("id")), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

const uploadBody = z.object({
  name: z.string().min(1).max(255),
  contentType: z.string().max(200),
  size: z.number().int().min(0).max(MAX_ATTACHMENTS_BYTES),
})

mailRoutes.post("/uploads", requireTrustedOrigin, requireSession, async (c) => {
  const body = await readBody(c, uploadBody)
  if (!body) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    return c.json(await createUpload(c.get("session").user.id, body), 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

// Raw bytes, one chunk per request, so no request comes near Vercel's 4.5 MB limit.
mailRoutes.put("/uploads/:id/chunks/:index", requireTrustedOrigin, requireSession, async (c) => {
  const index = Number(c.req.param("index"))
  if (!Number.isInteger(index)) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length > UPLOAD_CHUNK_BYTES) return c.json({ error: msg(c, "requestTooLarge") }, 413)
    await putChunk(c.get("session").user.id, c.req.param("id"), index, bytes)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return failure(c, error)
  }
})

mailRoutes.delete("/uploads/:id", requireTrustedOrigin, requireSession, async (c) => {
  await deleteUploads(c.get("session").user.id, [c.req.param("id")])
  return c.json({ ok: true }, 200, noStore)
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
  const dropped = await dropOldUploads()
  const overdue = await catchUp()
  return c.json({ ...(await renewWatches()), droppedUploads: dropped, overdue }, 200, noStore)
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
