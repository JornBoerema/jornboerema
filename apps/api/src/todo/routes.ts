import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { getAuth } from "@evido/auth/server"
import { commandSchema } from "@evido/todo-core/workspace"
import { sharingCommand } from "@evido/todo-core/sharing"
import { workspaceCommand } from "@evido/todo-core/workspaces"
import { sendEmail } from "@evido/email"
import { defer } from "../lib/defer"
import { KeyedError, languageOf, msg, validationMessage, type MessageKey } from "../i18n"
import { notifyWorkspaceUsers, realtimeEnabled, sealChannel, userChannel } from "../lib/realtime"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"
import {
  executeCommand,
  InvalidCommandError,
  NotFoundError,
  NoteConflictError,
  readLinkedWorkspace,
  readWorkspace,
} from "./workspace-server"
import { changeSharing, readSharing } from "./sharing-server"
import { z } from "zod"
import { ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES } from "@evido/todo-core/board"
import {
  completeAttachment,
  createAttachment,
  putAttachmentChunk,
  readAttachment,
} from "./attachments-server"
import {
  acceptInvitation,
  changeWorkspace,
  listWorkspaces,
  readInvitation,
  readMembers,
  WorkspaceError,
} from "./workspaces-server"

const tooLarge = (c: Context) => c.json({ error: msg(c, "requestTooLarge") }, 413)
const commandLimit = bodyLimit({ maxSize: 650_000, onError: tooLarge })

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

const keyed = (c: Context, error: KeyedError) => ({ error: msg(c, error.key) })

function commandFailure(c: Context, error: unknown, notFound: MessageKey) {
  if (error instanceof NoteConflictError) return c.json(keyed(c, error), 409)
  if (error instanceof InvalidCommandError) return c.json(keyed(c, error), 400)
  if (error instanceof NotFoundError) return c.json({ error: msg(c, notFound) }, 404)
  console.error("Workspace mutation failed", error)
  return c.json({ error: msg(c, "saveFailed") }, 500)
}

export const todoRoutes = new Hono<AppEnv>()

// ─── Own workspace ──────────────────────────────────────────────────────────

todoRoutes.get("/workspace", requireSession, async (c) => {
  try {
    const data = await readWorkspace(c.get("session").user.id, c.req.query("workspaceId") ?? "")
    return c.json(data, 200, noStore)
  } catch (error) {
    if (error instanceof NotFoundError) return c.json({ error: msg(c, "noWorkspaceAccess") }, 404)
    throw error
  }
})

todoRoutes.post("/workspace", requireTrustedOrigin, commandLimit, requireSession, async (c) => {
  const result = commandSchema.safeParse(await jsonBody(c))
  if (!result.success)
    return c.json({ error: validationMessage(c, result.error.issues[0]?.message) }, 400)
  try {
    const recipients = await executeCommand(c.get("session").user.id, result.data, languageOf(c))
    // An unavailable realtime provider must not undo or misreport a committed write.
    defer(() => notifyWorkspaceUsers(recipients))
    return c.json({ ok: true })
  } catch (error) {
    return commandFailure(c, error, "listOrTaskGone")
  }
})

// ─── Board attachments (chunked, like mail uploads) ─────────────────────────

const attachmentBody = z.object({
  todoId: z.uuid(),
  name: z.string().trim().min(1).max(255),
  contentType: z.string().max(200),
  size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
})

todoRoutes.post(
  "/todo-attachments",
  requireTrustedOrigin,
  bodyLimit({ maxSize: 4096, onError: tooLarge }),
  requireSession,
  async (c) => {
    const body = attachmentBody.safeParse(await jsonBody(c))
    if (!body.success) return c.json({ error: msg(c, "attachmentTooLarge") }, 400)
    try {
      return c.json(await createAttachment(c.get("session").user.id, body.data), 200, noStore)
    } catch (error) {
      return commandFailure(c, error, "listOrTaskGone")
    }
  }
)

// Raw bytes, one chunk per request, so no request comes near Vercel's 4.5 MB limit.
todoRoutes.put("/todo-attachments/:id/chunks/:index", requireTrustedOrigin, requireSession, async (c) => {
  const index = Number(c.req.param("index"))
  if (!Number.isInteger(index)) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length > ATTACHMENT_CHUNK_BYTES) return c.json({ error: msg(c, "requestTooLarge") }, 413)
    await putAttachmentChunk(c.get("session").user.id, c.req.param("id"), index, bytes)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return commandFailure(c, error, "listOrTaskGone")
  }
})

todoRoutes.post("/todo-attachments/:id/complete", requireTrustedOrigin, requireSession, async (c) => {
  try {
    const recipients = await completeAttachment(c.get("session").user.id, c.req.param("id"))
    defer(() => notifyWorkspaceUsers(recipients))
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    return commandFailure(c, error, "listOrTaskGone")
  }
})

function sendFile(file: { name: string; contentType: string; bytes: Buffer }) {
  // Always a download, never rendered on the API's origin.
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      ...noStore,
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  })
}

todoRoutes.get("/todo-attachments/:id", requireSession, async (c) => {
  try {
    return sendFile(await readAttachment({ userId: c.get("session").user.id }, c.req.param("id")))
  } catch (error) {
    return commandFailure(c, error, "listOrTaskGone")
  }
})

todoRoutes.get("/shared/:token/attachments/:id", async (c) => {
  try {
    return sendFile(await readAttachment({ shareToken: c.req.param("token") }, c.req.param("id")))
  } catch (error) {
    return commandFailure(c, error, "linkUnavailable")
  }
})

// ─── Realtime: a sealed live query on the user's own channel ──────────────

todoRoutes.get("/realtime", requireSession, async (c) => {
  if (!realtimeEnabled()) return c.json({ error: msg(c, "realtimeUnavailable") }, 503)
  return c.json(await sealChannel(userChannel(c.get("session").user.id)), 200, noStore)
})

// ─── Workspaces ─────────────────────────────────────────────────────────────

function workspaceFailure(c: Context, error: unknown) {
  if (error instanceof NotFoundError) return c.json({ error: msg(c, "noWorkspaceAccess") }, 404)
  if (error instanceof WorkspaceError) return c.json(keyed(c, error), 400)
  console.error("Workspace change failed", error)
  return c.json({ error: msg(c, "genericFailure") }, 500)
}

todoRoutes.get("/workspaces", requireSession, async (c) =>
  c.json(await listWorkspaces(c.get("session").user.id, languageOf(c)), 200, noStore)
)

todoRoutes.get("/workspaces/:id/members", requireSession, async (c) => {
  try {
    return c.json(await readMembers(c.get("session").user.id, c.req.param("id")), 200, noStore)
  } catch (error) {
    return workspaceFailure(c, error)
  }
})

todoRoutes.post(
  "/workspaces",
  requireTrustedOrigin,
  bodyLimit({ maxSize: 4096, onError: tooLarge }),
  requireSession,
  async (c) => {
    const session = c.get("session")
    const command = workspaceCommand.safeParse(await jsonBody(c))
    if (!command.success)
      return c.json({ error: validationMessage(c, command.error.issues[0]?.message) }, 400)
    if (command.data.type === "invite" && !session.user.emailVerified)
      return c.json({ error: msg(c, "confirmEmailFirst") }, 401)
    try {
      const result = await changeWorkspace(session.user.id, command.data, languageOf(c))
      defer(() => notifyWorkspaceUsers(result.recipients))
      if (result.mail)
        try {
          await sendEmail(result.mail)
        } catch (error) {
          // The invitation is stored; only the e-mail failed. Resending is safe.
          console.error("Workspace invitation e-mail failed", error)
          return c.json({ error: msg(c, "inviteMailFailed") }, 502)
        }
      return c.json({ ok: true })
    } catch (error) {
      return workspaceFailure(c, error)
    }
  }
)

// ─── Public list links ──────────────────────────────────────────────────────

todoRoutes.get("/sharing", requireSession, async (c) => {
  try {
    return c.json(
      await readSharing(c.get("session").user.id, c.req.query("listId") ?? ""),
      200,
      noStore
    )
  } catch (error) {
    return workspaceFailure(c, error)
  }
})

todoRoutes.post(
  "/sharing",
  requireTrustedOrigin,
  bodyLimit({ maxSize: 4096, onError: tooLarge }),
  requireSession,
  async (c) => {
    const command = sharingCommand.safeParse(await jsonBody(c))
    if (!command.success) return c.json({ error: msg(c, "checkInput") }, 400)
    try {
      const result = await changeSharing(c.get("session").user.id, command.data)
      defer(() => notifyWorkspaceUsers(result.recipients))
      return c.json({ ok: true })
    } catch (error) {
      return workspaceFailure(c, error)
    }
  }
)

// ─── Invitations ────────────────────────────────────────────────────────────

todoRoutes.get("/invitations/:token", async (c) => {
  const invite = await readInvitation(c.req.param("token"))
  if (!invite) return c.json({ error: msg(c, "invitationUnavailable") }, 404, noStore)
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  return c.json(
    {
      workspaceName: invite.workspaceName,
      role: invite.role,
      signedIn: !!session,
      wrongAccount:
        !!session &&
        (!session.user.emailVerified || session.user.email.toLowerCase() !== invite.email),
    },
    200,
    { ...noStore, "Referrer-Policy": "no-referrer" }
  )
})

todoRoutes.post("/invitations/:token", requireTrustedOrigin, requireSession, async (c) => {
  try {
    const result = await acceptInvitation(c.get("session").user.id, c.req.param("token"), languageOf(c))
    defer(() => notifyWorkspaceUsers(result.recipients))
    return c.json({ workspaceId: result.workspaceId })
  } catch (error) {
    if (error instanceof WorkspaceError) return c.json(keyed(c, error), 403)
    if (error instanceof NotFoundError)
      return c.json({ error: msg(c, "invitationGone") }, 404)
    console.error("Accepting invitation failed", error)
    return c.json({ error: msg(c, "acceptFailed") }, 500)
  }
})

// ─── Link-shared lists (no account) ─────────────────────────────────────────

const sharedHeaders = {
  ...noStore,
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}

const readShared = async (c: Context) => {
  try {
    return c.json(await readLinkedWorkspace(c.req.param("token") ?? ""), 200, sharedHeaders)
  } catch (error) {
    c.header("Cache-Control", noStore["Cache-Control"])
    return commandFailure(c, error, "linkUnavailable")
  }
}

const writeShared = async (c: Context) => {
  c.header("Cache-Control", noStore["Cache-Control"])
  const command = commandSchema.safeParse(await jsonBody(c))
  if (!command.success) return c.json({ error: validationMessage(c, command.error.issues[0]?.message) }, 400)
  try {
    const recipients = await executeCommand({ shareToken: c.req.param("token") ?? "" }, command.data)
    defer(() => notifyWorkspaceUsers(recipients))
    return c.json({ ok: true })
  } catch (error) {
    return commandFailure(c, error, "linkUnavailable")
  }
}

todoRoutes.get("/shared/:token", readShared)
todoRoutes.post("/shared/:token", requireTrustedOrigin, commandLimit, writeShared)
