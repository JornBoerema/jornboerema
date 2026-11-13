import { randomUUID } from "node:crypto"
import { createMiddleware } from "hono/factory"
import { getDb } from "@evido/db"
import { env } from "../env"
import { msg } from "../i18n"
import { findApp, mailOpen, type AppId } from "./apps"
import type { AppEnv } from "./session"

type SessionUser = { id: string; email: string; emailVerified: boolean }

/** Recently checked users, so every request of a busy mailbox doesn't ask the database. */
const granted = new Map<string, number>()
const GRANTED_TTL_MS = 60_000

const cacheKey = (userId: string, app: AppId) => `${app}:${userId}`

/** Forgets cached access, after a revoke, so it takes effect on this instance at once. */
export const forgetAccess = (userId: string, app: AppId) => granted.delete(cacheKey(userId, app))

/**
 * Whether the user may use an invite-only app. An invitation for their
 * verified email turns into access the first time they come by.
 */
export async function hasAppAccess(user: SessionUser, app: AppId) {
  const key = cacheKey(user.id, app)
  if ((granted.get(key) ?? 0) > Date.now()) return true
  const db = getDb()
  let allowed = Boolean(await db.appAccess.findUnique({ where: { userId_app: { userId: user.id, app } } }))
  if (!allowed && user.emailVerified) {
    const invite = await db.appInvite.findUnique({ where: { app_email: { app, email: user.email.toLowerCase() } } })
    if (invite) {
      await db.$transaction([
        db.appAccess.upsert({
          where: { userId_app: { userId: user.id, app } },
          create: { userId: user.id, app, grantedBy: invite.invitedBy },
          update: {},
        }),
        db.appInvite.update({ where: { id: invite.id }, data: { acceptedAt: invite.acceptedAt ?? new Date() } }),
        db.appAccessRequest.deleteMany({ where: { app, userId: user.id } }),
      ])
      allowed = true
    }
  }
  if (allowed) granted.set(key, Date.now() + GRANTED_TTL_MS)
  return allowed
}

/**
 * Gmail for those who had it before it took its own invitation: everyone while
 * Even mailen itself is invite-only, and afterwards whoever was let into Even
 * mailen in that time or already has a Gmail mailbox connected.
 */
async function hadGmailBefore(userId: string) {
  if (!mailOpen()) return true
  const db = getDb()
  if (await db.appAccess.findUnique({ where: { userId_app: { userId, app: "mail" } } })) return true
  return Boolean(await db.mailAccount.findFirst({ where: { userId, provider: "gmail" }, select: { id: true } }))
}

/** Whether the user may use an app: open ones always, invite-only ones when let in. */
export async function canUse(user: SessionUser, app: AppId) {
  if (!findApp(app)?.inviteOnly()) return true
  if (await hasAppAccess(user, app)) return true
  return app === "gmail" && (await hadGmailBefore(user.id))
}

/** After requireSession: answers 403 with `noAccess` for users not let in yet. */
export const requireAppAccess = (app: AppId) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!(await canUse(c.get("session").user, app)))
      return c.json({ error: msg(c, "noAppAccess"), noAccess: true }, 403)
    await next()
  })

export const isAdmin = (user: SessionUser) =>
  user.emailVerified && env.adminEmails.includes(user.email.toLowerCase())

/** After requireSession. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isAdmin(c.get("session").user)) return c.json({ error: msg(c, "notAdmin") }, 403)
  await next()
})

export async function requestAccess(userId: string, app: AppId) {
  const db = getDb()
  const existing = await db.appAccessRequest.findUnique({ where: { app_userId: { app, userId } } })
  if (existing) return { created: false }
  await db.appAccessRequest.create({ data: { id: randomUUID(), app, userId } })
  return { created: true }
}
