import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { getAuth } from "@evido/auth/server"
import { commandSchema } from "@evido/todo-core/workspace"
import { sharingCommand } from "@evido/todo-core/sharing"
import { workspaceCommand } from "@evido/todo-core/workspaces"
import { sendEmail } from "@evido/email"
import { defer } from "../lib/defer"
import { getRealtime, notifyWorkspaceUsers, userChannel } from "../lib/realtime"
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
import {
  acceptInvitation,
  changeWorkspace,
  listWorkspaces,
  readInvitation,
  readMembers,
  WorkspaceError,
} from "./workspaces-server"

const tooLarge = (c: Context) => c.json({ error: "Verzoek te groot." }, 413)
const commandLimit = bodyLimit({ maxSize: 650_000, onError: tooLarge })

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

function commandFailure(c: Context, error: unknown, notFound: string) {
  if (error instanceof NoteConflictError) return c.json({ error: error.message }, 409)
  if (error instanceof InvalidCommandError) return c.json({ error: error.message }, 400)
  if (error instanceof NotFoundError) return c.json({ error: notFound }, 404)
  console.error("Workspace mutation failed", error)
  return c.json({ error: "Opslaan is niet gelukt. Probeer het opnieuw." }, 500)
}

export const todoRoutes = new Hono<AppEnv>()

// ─── Own workspace ──────────────────────────────────────────────────────────

todoRoutes.get("/workspace", requireSession, async (c) => {
  try {
    const data = await readWorkspace(c.get("session").user.id, c.req.query("workspaceId") ?? "")
    return c.json(data, 200, noStore)
  } catch (error) {
    if (error instanceof NotFoundError) return c.json({ error: "Geen toegang tot deze workspace." }, 404)
    throw error
  }
})

todoRoutes.post("/workspace", requireTrustedOrigin, commandLimit, requireSession, async (c) => {
  const result = commandSchema.safeParse(await jsonBody(c))
  if (!result.success)
    return c.json({ error: result.error.issues[0]?.message ?? "Controleer je invoer." }, 400)
  try {
    const recipients = await executeCommand(c.get("session").user.id, result.data)
    // An unavailable realtime provider must not undo or misreport a committed write.
    defer(() => notifyWorkspaceUsers(recipients))
    return c.json({ ok: true })
  } catch (error) {
    return commandFailure(c, error, "Deze lijst of taak bestaat niet meer.")
  }
})

// ─── Realtime token (subscribe-only on the user's own channel) ──────────────

todoRoutes.get("/realtime", requireSession, async (c) => {
  if (!process.env.ABLY_API_KEY) return c.json({ error: "Realtime niet beschikbaar." }, 503)
  const userId = c.get("session").user.id
  const token = await getRealtime().auth.createTokenRequest({
    clientId: userId,
    capability: JSON.stringify({ [userChannel(userId)]: ["subscribe"] }),
    ttl: 15 * 60 * 1000,
  })
  return c.json(token, 200, noStore)
})

// ─── Workspaces ─────────────────────────────────────────────────────────────

function workspaceFailure(c: Context, error: unknown) {
  if (error instanceof NotFoundError) return c.json({ error: "Geen toegang tot deze workspace." }, 404)
  if (error instanceof WorkspaceError) return c.json({ error: error.message }, 400)
  console.error("Workspace change failed", error)
  return c.json({ error: "Dit is niet gelukt. Probeer het over een minuut opnieuw." }, 500)
}

todoRoutes.get("/workspaces", requireSession, async (c) =>
  c.json(await listWorkspaces(c.get("session").user.id), 200, noStore)
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
      return c.json({ error: command.error.issues[0]?.message ?? "Controleer je invoer." }, 400)
    if (command.data.type === "invite" && !session.user.emailVerified)
      return c.json({ error: "Bevestig eerst je e-mailadres." }, 401)
    try {
      const result = await changeWorkspace(session.user.id, command.data)
      defer(() => notifyWorkspaceUsers(result.recipients))
      if (result.mail)
        try {
          await sendEmail(result.mail)
        } catch (error) {
          // The invitation is stored; only the e-mail failed. Resending is safe.
          console.error("Workspace invitation e-mail failed", error)
          return c.json(
            { error: "De uitnodiging is opgeslagen, maar de e-mail kon niet worden verstuurd. Probeer het over een minuut opnieuw." },
            502
          )
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
    if (!command.success) return c.json({ error: "Controleer je invoer." }, 400)
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
  if (!invite) return c.json({ error: "Uitnodiging niet beschikbaar." }, 404, noStore)
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
    const result = await acceptInvitation(c.get("session").user.id, c.req.param("token"))
    defer(() => notifyWorkspaceUsers(result.recipients))
    return c.json({ workspaceId: result.workspaceId })
  } catch (error) {
    if (error instanceof WorkspaceError) return c.json({ error: error.message }, 403)
    if (error instanceof NotFoundError)
      return c.json({ error: "Deze uitnodiging is verlopen, ingetrokken of al gebruikt." }, 404)
    console.error("Accepting invitation failed", error)
    return c.json({ error: "Accepteren is niet gelukt." }, 500)
  }
})

// ─── Link-shared lists (no account) ─────────────────────────────────────────

const sharedHeaders = {
  ...noStore,
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}
const linkUnavailable = "Deze link is niet meer beschikbaar of geeft geen bewerkrechten."

todoRoutes.get("/gedeeld/:token", async (c) => {
  try {
    return c.json(await readLinkedWorkspace(c.req.param("token")), 200, sharedHeaders)
  } catch (error) {
    c.header("Cache-Control", noStore["Cache-Control"])
    return commandFailure(c, error, linkUnavailable)
  }
})

todoRoutes.post("/gedeeld/:token", requireTrustedOrigin, commandLimit, async (c) => {
  c.header("Cache-Control", noStore["Cache-Control"])
  const command = commandSchema.safeParse(await jsonBody(c))
  if (!command.success) return c.json({ error: "Controleer je invoer." }, 400)
  try {
    const recipients = await executeCommand({ shareToken: c.req.param("token") }, command.data)
    defer(() => notifyWorkspaceUsers(recipients))
    return c.json({ ok: true })
  } catch (error) {
    return commandFailure(c, error, linkUnavailable)
  }
})
