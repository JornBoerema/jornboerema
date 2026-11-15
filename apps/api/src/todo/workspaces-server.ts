import { createHash, randomBytes, randomUUID } from "node:crypto"
import { getDb, type Tx } from "@even/db"
import { todoEmails, type Email } from "@even/email"
import {
  canManageWorkspace,
  type WorkspaceCommand,
  type WorkspaceMembers,
  type WorkspaceRole,
  type WorkspaceSummary,
} from "@even/todo-core/workspaces"
import type { Language } from "@even/i18n"
import { env } from "../env"
import { KeyedError, translate } from "../i18n"
import { NotFoundError, SHARE_TOKEN } from "./workspace-server"
import { ensureStatuses } from "./board-server"
import { hasRunningSubscription } from "@even/auth/billing"
import { defer } from "../lib/defer"
import { dropUnconnectedMailboxes } from "../mail/accounts-server"

/** Message is a translation key (see ../i18n.ts). */
export class WorkspaceError extends KeyedError {}

const hash = (token: string) => createHash("sha256").update(token).digest("hex")
const INVITE_TTL = 7 * 86400000

/**
 * The user's organizations, their personal one first. Every user has exactly one
 * personal organization; it is made the first time it is missing.
 */
export async function listWorkspaces(
  userId: string,
  language: Language = "en"
): Promise<WorkspaceSummary[]> {
  const read = () =>
    getDb().member.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { organization: { include: { _count: { select: { members: true } } } } },
    })
  let memberships = await read()
  if (!memberships.some((m) => m.organization.personal)) {
    await ensurePersonalOrganization(userId, language)
    memberships = await read()
  }
  return memberships
    .map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      role: m.role,
      memberCount: m.organization._count.members,
      personal: m.organization.personal,
    }))
    .sort((a, b) => Number(b.personal) - Number(a.personal))
}

/** The user's personal organization, made when it is missing. Two requests at once make one. */
export async function ensurePersonalOrganization(userId: string, language: Language = "en") {
  const db = getDb()
  return db.$transaction(async (tx) => {
    // One user at a time: lock the user row, then look.
    await tx.$queryRaw`select id from "user" where id = ${userId} for update`
    const existing = await tx.member.findFirst({
      where: { userId, organization: { personal: true } },
      select: { organizationId: true },
    })
    if (existing) return existing.organizationId
    const id = randomUUID()
    await createOrganization(tx, userId, id, translate(language, "personalWorkspace"), language, true)
    return id
  })
}

async function createOrganization(
  tx: Tx,
  userId: string,
  id: string,
  name: string,
  language: Language,
  personal = false
) {
  await tx.organization.create({
    data: {
      id,
      name,
      slug: id,
      personal,
      members: { create: { id: randomUUID(), userId, role: "owner" } },
    },
  })
  await ensureStatuses(tx, id, language)
}

/** Locks the organization row and returns the caller's membership. */
async function lockMembership(tx: Tx, workspaceId: string, userId: string) {
  const [workspace] = await tx.$queryRaw<{ id: string; name: string; personal: boolean }[]>`
    select id, name, personal from organizations where id = ${workspaceId} for update`
  if (!workspace) throw new NotFoundError()
  const members = await tx.member.findMany({ where: { organizationId: workspaceId } })
  const me = members.find((m) => m.userId === userId)
  if (!me) throw new NotFoundError()
  return { workspace, members, me }
}

function requireManager(role: WorkspaceRole) {
  if (!canManageWorkspace(role))
    throw new WorkspaceError("onlyManagers")
}

export async function readMembers(userId: string, workspaceId: string): Promise<WorkspaceMembers> {
  const members = await getDb().member.findMany({
    where: { organizationId: workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { user: { select: { name: true, email: true } } },
  })
  if (!members.some((m) => m.userId === userId)) throw new NotFoundError()
  const invitations = await getDb().invitation.findMany({
    where: { organizationId: workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  })
  return {
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    })),
  }
}

export async function changeWorkspace(
  userId: string,
  command: WorkspaceCommand,
  /** The inviter's language, used for the invitation e-mail. */
  language: Language = "en"
): Promise<{ recipients: string[]; mail?: Email; seats?: string }> {
  if (command.type === "create") {
    await createOrganization(getDb(), userId, command.id, command.name, language)
    return { recipients: [userId] }
  }
  const result = await getDb().$transaction(async (tx) => {
    const { workspace, members, me } = await lockMembership(tx, command.workspaceId, userId)
    const everyone = members.map((m) => m.userId)
    // A personal organization is the user alone: it can be renamed, nothing more.
    if (workspace.personal && command.type !== "rename") throw new WorkspaceError("personalOrganization")
    switch (command.type) {
      case "rename":
        requireManager(me.role)
        await tx.organization.update({ where: { id: workspace.id }, data: { name: command.name } })
        return { recipients: everyone }
      case "delete":
        if (me.role !== "owner")
          throw new WorkspaceError("onlyOwnerDeletes")
        // A subscription that still runs is cancelled in the billing settings first.
        if (await hasRunningSubscription(tx, workspace.id))
          throw new WorkspaceError("organizationStillPays")
        await tx.organization.delete({ where: { id: workspace.id } })
        return { recipients: everyone }
      case "leave":
        if (me.role === "owner")
          throw new WorkspaceError("ownerCannotLeave")
        await tx.member.delete({ where: { id: me.id } })
        // Their mailboxes in it leave with them.
        await tx.mailConnection.deleteMany({ where: { userId, organizationId: workspace.id } })
        return { recipients: everyone, seats: workspace.id }
      case "update-member":
      case "remove-member": {
        requireManager(me.role)
        const target = members.find((m) => m.id === command.memberId)
        if (!target) throw new NotFoundError()
        if (target.role === "owner")
          throw new WorkspaceError("ownerUntouchable")
        if (target.id === me.id)
          throw new WorkspaceError("useLeave")
        if (command.type === "update-member") {
          await tx.member.update({ where: { id: target.id }, data: { role: command.role } })
          return { recipients: everyone }
        }
        await tx.member.delete({ where: { id: target.id } })
        await tx.mailConnection.deleteMany({ where: { userId: target.userId, organizationId: workspace.id } })
        return { recipients: everyone, seats: workspace.id }
      }
      case "revoke-invite":
        requireManager(me.role)
        await tx.invitation.deleteMany({
          where: { id: command.invitationId, organizationId: workspace.id },
        })
        return { recipients: everyone }
      case "invite": {
        requireManager(me.role)
        const existing = await tx.member.count({
          where: {
            organizationId: workspace.id,
            user: { email: { equals: command.email, mode: "insensitive" } },
          },
        })
        if (existing) throw new WorkspaceError("alreadyMember")
        const previous = await tx.invitation.findUnique({
          where: { organizationId_email: { organizationId: workspace.id, email: command.email } },
        })
        if (previous && !previous.acceptedAt && Date.now() - previous.updatedAt.getTime() < 60000)
          throw new WorkspaceError("inviteTooSoon")
        const now = Date.now()
        const windowStart = now - 3600000
        const [limit] = await tx.$queryRaw<{ count: number }[]>`
          insert into rate_limit (id, key, count, last_request)
          values (${randomUUID()}, ${`workspace-invites:${userId}`}, 1, ${now})
          on conflict (key) do update set
            count = case when rate_limit.last_request < ${windowStart} then 1 else rate_limit.count + 1 end,
            last_request = case when rate_limit.last_request < ${windowStart} then ${now} else rate_limit.last_request end
          returning count`
        if (limit.count > 20)
          throw new WorkspaceError("inviteLimit")
        const token = randomBytes(32).toString("base64url")
        const values = {
          role: command.role,
          tokenHash: hash(token),
          inviterId: userId,
          status: "pending",
          expiresAt: new Date(now + INVITE_TTL),
          acceptedAt: null,
          updatedAt: new Date(now),
        }
        await tx.invitation.upsert({
          where: { organizationId_email: { organizationId: workspace.id, email: command.email } },
          create: { id: randomUUID(), organizationId: workspace.id, email: command.email, ...values },
          update: values,
        })
        const inviter = await tx.user.findUniqueOrThrow({ where: { id: userId } })
        return {
          recipients: everyone,
          mail: todoEmails.workspaceInvitation({
            to: command.email,
            inviterName: inviter.name,
            workspaceName: workspace.name,
            role: command.role,
            url: `${env.todoWebUrl}/invite/${token}`,
            language,
          }),
        }
      }
    }
  })
  // An organization gone, or someone out of it: mailboxes nobody else has go too.
  if (command.type === "delete" || command.type === "leave" || command.type === "remove-member")
    defer(() => dropUnconnectedMailboxes())
  return result
}

export async function readInvitation(token: string) {
  if (!SHARE_TOKEN.test(token)) return null
  const invite = await getDb().invitation.findUnique({
    where: { tokenHash: hash(token) },
    include: { organization: { select: { id: true, name: true } } },
  })
  if (!invite || invite.expiresAt <= new Date()) return null
  return {
    workspaceId: invite.organization.id,
    workspaceName: invite.organization.name,
    email: invite.email,
    role: invite.role,
  }
}

export async function acceptInvitation(userId: string, token: string, language: Language = "en") {
  if (!SHARE_TOKEN.test(token)) throw new NotFoundError()
  return getDb().$transaction(async (tx) => {
    const candidate = await tx.invitation.findUnique({
      where: { tokenHash: hash(token) },
    })
    if (!candidate) throw new NotFoundError()
    // Lock the organization first, then the invitation, like every other writer.
    const [workspace] = await tx.$queryRaw<{ id: string }[]>`
      select id from organizations where id = ${candidate.organizationId} for update`
    if (!workspace) throw new NotFoundError()
    const [invite] = await tx.$queryRaw<
      { id: string; email: string; role: WorkspaceRole; expiresAt: Date; acceptedAt: Date | null }[]
    >`select id, email, role::text as role, expires_at as "expiresAt", accepted_at as "acceptedAt"
      from invitations where id = ${candidate.id} for update`
    if (!invite || invite.expiresAt < new Date()) throw new NotFoundError()
    const recipient = await tx.user.findUnique({ where: { id: userId } })
    if (!recipient?.emailVerified || recipient.email.toLowerCase() !== invite.email)
      throw new WorkspaceError("wrongInviteAccount")
    const member = await tx.member.findUnique({
      where: { organizationId_userId: { organizationId: workspace.id, userId } },
    })
    if (invite.acceptedAt && !member) throw new NotFoundError()
    if (!invite.acceptedAt) {
      // New users get their own personal organization next to the shared one.
      if (!(await tx.member.count({ where: { userId, organization: { personal: true } } })))
        await createOrganization(tx, userId, randomUUID(), translate(language, "personalWorkspace"), language, true)
      if (!member)
        await tx.member.create({
          data: { id: randomUUID(), organizationId: workspace.id, userId, role: invite.role },
        })
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), status: "accepted" },
      })
    }
    const members = await tx.member.findMany({
      where: { organizationId: workspace.id },
      select: { userId: true },
    })
    return { workspaceId: workspace.id, recipients: members.map((m) => m.userId) }
  })
}
