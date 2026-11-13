import { randomUUID } from "node:crypto"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { getDb } from "@evido/db"
import { accessEmails, queueEmail } from "@evido/email"
import { env } from "../env"
import { languageOf, msg } from "../i18n"
import { canUse, forgetAccess, isAdmin, needsPlan, requestAccess, requireAdmin } from "../lib/access"
import { APPS, findApp } from "../lib/apps"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"
import { GithubError, getStatus } from "./status"

/** Asked by the apps themselves: may this user come in, and if not, ask for it. */
export const accessRoutes = new Hono<AppEnv>()

accessRoutes.get("/:app", requireSession, async (c) => {
  const app = findApp(c.req.param("app"))
  if (!app) return c.json({ error: msg(c, "invalidRequest") }, 404)
  const user = c.get("session").user
  const access = await canUse(user, app.id)
  const requested = access
    ? false
    : Boolean(await getDb().appAccessRequest.findUnique({ where: { app_userId: { app: app.id, userId: user.id } } }))
  // Open to all but not paid for: the app offers a subscription instead of asking for access.
  const unpaid = !access && app.id === "mail" && (await needsPlan(user))
  return c.json({ access, requested, needsPlan: unpaid }, 200, noStore)
})

accessRoutes.post("/:app/request", requireTrustedOrigin, requireSession, async (c) => {
  const app = findApp(c.req.param("app"))
  if (!app) return c.json({ error: msg(c, "invalidRequest") }, 404)
  const user = c.get("session").user
  if (await canUse(user, app.id)) return c.json({ access: true, requested: false }, 200, noStore)
  const { created } = await requestAccess(user.id, app.id)
  // One mail per request, not per click.
  if (created)
    for (const to of env.adminEmails)
      queueEmail(accessEmails.requested({ to, appName: app.name, who: `${user.name} (${user.email})`, url: `${env.adminWebUrl}/admin` }))
  return c.json({ access: false, requested: true }, 200, noStore)
})

/** jornboerema.nl/admin: who may use which app. */
export const adminRoutes = new Hono<AppEnv>()
adminRoutes.use("*", requireSession, requireAdmin)

adminRoutes.get("/me", (c) => {
  const user = c.get("session").user
  return c.json({ admin: isAdmin(user), name: user.name, email: user.email }, 200, noStore)
})

/** Builds, GitHub Actions and the version of every app. */
adminRoutes.get("/status", async (c) => {
  try {
    return c.json({ ...(await getStatus()), tokenConfigured: Boolean(env.githubToken) }, 200, noStore)
  } catch (error) {
    const code = error instanceof GithubError ? error.code : "github_unavailable"
    console.error("[admin] status", error)
    return c.json({ error: code, tokenConfigured: Boolean(env.githubToken) }, 502, noStore)
  }
})

adminRoutes.get("/apps", async (c) => {
  const db = getDb()
  const apps = await Promise.all(
    APPS.map(async (app) => ({
      id: app.id,
      name: app.name,
      url: app.url(),
      inviteOnly: app.inviteOnly(),
      members: await db.appAccess.count({ where: { app: app.id } }),
      invites: await db.appInvite.count({ where: { app: app.id, acceptedAt: null } }),
      requests: await db.appAccessRequest.count({ where: { app: app.id } }),
    }))
  )
  return c.json({ apps }, 200, noStore)
})

function appOf(c: Context) {
  return findApp(c.req.param("app") ?? "") ?? null
}

adminRoutes.get("/apps/:app", async (c) => {
  const app = appOf(c)
  if (!app) return c.json({ error: msg(c, "invalidRequest") }, 404)
  const db = getDb()
  const user = { select: { id: true, name: true, email: true, image: true } } as const
  const [members, invites, requests] = await Promise.all([
    db.appAccess.findMany({ where: { app: app.id }, include: { user }, orderBy: { grantedAt: "desc" } }),
    db.appInvite.findMany({ where: { app: app.id, acceptedAt: null }, orderBy: { createdAt: "desc" } }),
    db.appAccessRequest.findMany({ where: { app: app.id }, include: { user }, orderBy: { createdAt: "asc" } }),
  ])
  return c.json(
    {
      app: { id: app.id, name: app.name, url: app.url(), inviteOnly: app.inviteOnly() },
      members: members.map((member) => ({ ...member.user, grantedAt: member.grantedAt, grantedBy: member.grantedBy })),
      invites: invites.map(({ id, email, invitedBy, createdAt }) => ({ id, email, invitedBy, createdAt })),
      requests: requests.map((request) => ({ id: request.id, createdAt: request.createdAt, user: request.user })),
    },
    200,
    noStore
  )
})

const inviteBody = z.object({ email: z.email().max(320) })

adminRoutes.post("/apps/:app/invites", requireTrustedOrigin, async (c) => {
  const app = appOf(c)
  const body = inviteBody.safeParse(await c.req.json().catch(() => null))
  if (!app || !body.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  const db = getDb()
  const email = body.data.email.trim().toLowerCase()
  const admin = c.get("session").user.email
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (existing && (await db.appAccess.findUnique({ where: { userId_app: { userId: existing.id, app: app.id } } })))
    return c.json({ error: msg(c, "alreadyHasAccess") }, 409)
  const invite = await db.appInvite.upsert({
    where: { app_email: { app: app.id, email } },
    create: { id: randomUUID(), app: app.id, email, invitedBy: admin },
    update: { invitedBy: admin, createdAt: new Date(), acceptedAt: null },
  })
  queueEmail(accessEmails.invite({ to: email, appName: app.name, url: app.url(), language: languageOf(c) }))
  return c.json({ id: invite.id }, 200, noStore)
})

adminRoutes.delete("/apps/:app/invites/:id", requireTrustedOrigin, async (c) => {
  const app = appOf(c)
  if (!app) return c.json({ error: msg(c, "invalidRequest") }, 404)
  await getDb().appInvite.deleteMany({ where: { id: c.req.param("id"), app: app.id } })
  return c.json({ ok: true }, 200, noStore)
})

adminRoutes.post("/apps/:app/requests/:id/approve", requireTrustedOrigin, async (c) => {
  const app = appOf(c)
  if (!app) return c.json({ error: msg(c, "invalidRequest") }, 404)
  const db = getDb()
  const request = await db.appAccessRequest.findFirst({
    where: { id: c.req.param("id"), app: app.id },
    include: { user: { select: { email: true } } },
  })
  if (!request) return c.json({ error: msg(c, "invalidRequest") }, 404)
  await db.$transaction([
    db.appAccess.upsert({
      where: { userId_app: { userId: request.userId, app: app.id } },
      create: { userId: request.userId, app: app.id, grantedBy: c.get("session").user.email },
      update: {},
    }),
    db.appAccessRequest.delete({ where: { id: request.id } }),
  ])
  queueEmail(accessEmails.granted({ to: request.user.email, appName: app.name, url: app.url(), language: languageOf(c) }))
  return c.json({ ok: true }, 200, noStore)
})

adminRoutes.delete("/apps/:app/requests/:id", requireTrustedOrigin, async (c) => {
  const app = appOf(c)
  if (!app) return c.json({ error: msg(c, "invalidRequest") }, 404)
  await getDb().appAccessRequest.deleteMany({ where: { id: c.req.param("id"), app: app.id } })
  return c.json({ ok: true }, 200, noStore)
})

/** Takes access away. Their mailboxes stay until they delete them; they just can't open the app. */
adminRoutes.delete("/apps/:app/members/:userId", requireTrustedOrigin, async (c) => {
  const app = appOf(c)
  if (!app) return c.json({ error: msg(c, "invalidRequest") }, 404)
  const userId = c.req.param("userId")
  const db = getDb()
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  await db.$transaction([
    db.appAccess.deleteMany({ where: { userId, app: app.id } }),
    // Otherwise the invitation would let them straight back in.
    ...(user ? [db.appInvite.deleteMany({ where: { app: app.id, email: user.email.toLowerCase() } })] : []),
  ])
  forgetAccess(userId, app.id)
  return c.json({ ok: true }, 200, noStore)
})
