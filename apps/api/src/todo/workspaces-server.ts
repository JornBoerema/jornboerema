import { createHash, randomBytes, randomUUID } from "node:crypto"
import { getDb, type Tx } from "@evido/db"
import { todoEmails, type Email } from "@evido/email"
import {
  canManageWorkspace,
  type WorkspaceCommand,
  type WorkspaceMembers,
  type WorkspaceRole,
  type WorkspaceSummary,
} from "@evido/todo-core/workspaces"
import type { Language } from "@evido/i18n"
import { env } from "../env"
import { KeyedError, translate } from "../i18n"
import { NotFoundError, SHARE_TOKEN } from "./workspace-server"
import { ensureStatuses } from "./board-server"

/** Message is a translation key (see ../i18n.ts). */
export class WorkspaceError extends KeyedError {}

const hash = (token: string) => createHash("sha256").update(token).digest("hex")
const INVITE_TTL = 7 * 86400000

/** Every user always has at least one workspace; the first is made on demand. */
export async function listWorkspaces(
  userId: string,
  language: Language = "en"
): Promise<WorkspaceSummary[]> {
  const read = () =>
    getDb().workspaceMember.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { workspace: { include: { _count: { select: { members: true } } } } },
    })
  let memberships = await read()
  if (!memberships.length) {
    await createWorkspace(getDb(), userId, randomUUID(), translate(language, "personalWorkspace"), language)
    memberships = await read()
  }
  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    role: m.role,
    memberCount: m.workspace._count.members,
  }))
}

async function createWorkspace(tx: Tx, userId: string, id: string, name: string, language: Language) {
  await tx.workspace.create({
    data: {
      id,
      name,
      members: { create: { id: randomUUID(), userId, role: "owner" } },
    },
  })
  await ensureStatuses(tx, id, language)
}

/** Locks the workspace row and returns the caller's membership. */
async function lockMembership(tx: Tx, workspaceId: string, userId: string) {
  const [workspace] = await tx.$queryRaw<{ id: string; name: string }[]>`
    select id, name from workspaces where id = ${workspaceId} for update`
  if (!workspace) throw new NotFoundError()
  const members = await tx.workspaceMember.findMany({ where: { workspaceId } })
  const me = members.find((m) => m.userId === userId)
  if (!me) throw new NotFoundError()
  return { workspace, members, me }
}

function requireManager(role: WorkspaceRole) {
  if (!canManageWorkspace(role))
    throw new WorkspaceError("onlyManagers")
}

export async function readMembers(userId: string, workspaceId: string): Promise<WorkspaceMembers> {
  const members = await getDb().workspaceMember.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { user: { select: { name: true, email: true } } },
  })
  if (!members.some((m) => m.userId === userId)) throw new NotFoundError()
  const invitations = await getDb().workspaceInvitation.findMany({
    where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
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
): Promise<{ recipients: string[]; mail?: Email }> {
  if (command.type === "create") {
    await createWorkspace(getDb(), userId, command.id, command.name, language)
    return { recipients: [userId] }
  }
  return getDb().$transaction(async (tx) => {
    const { workspace, members, me } = await lockMembership(tx, command.workspaceId, userId)
    const everyone = members.map((m) => m.userId)
    switch (command.type) {
      case "rename":
        requireManager(me.role)
        await tx.workspace.update({ where: { id: workspace.id }, data: { name: command.name } })
        return { recipients: everyone }
      case "delete":
        if (me.role !== "owner")
          throw new WorkspaceError("onlyOwnerDeletes")
        await tx.workspace.delete({ where: { id: workspace.id } })
        return { recipients: everyone }
      case "leave":
        if (me.role === "owner")
          throw new WorkspaceError("ownerCannotLeave")
        await tx.workspaceMember.delete({ where: { id: me.id } })
        return { recipients: everyone }
      case "update-member":
      case "remove-member": {
        requireManager(me.role)
        const target = members.find((m) => m.id === command.memberId)
        if (!target) throw new NotFoundError()
        if (target.role === "owner")
          throw new WorkspaceError("ownerUntouchable")
        if (target.id === me.id)
          throw new WorkspaceError("useLeave")
        if (command.type === "update-member")
          await tx.workspaceMember.update({ where: { id: target.id }, data: { role: command.role } })
        else await tx.workspaceMember.delete({ where: { id: target.id } })
        return { recipients: everyone }
      }
      case "revoke-invite":
        requireManager(me.role)
        await tx.workspaceInvitation.deleteMany({
          where: { id: command.invitationId, workspaceId: workspace.id },
        })
        return { recipients: everyone }
      case "invite": {
        requireManager(me.role)
        const existing = await tx.workspaceMember.count({
          where: {
            workspaceId: workspace.id,
            user: { email: { equals: command.email, mode: "insensitive" } },
          },
        })
        if (existing) throw new WorkspaceError("alreadyMember")
        const previous = await tx.workspaceInvitation.findUnique({
          where: { workspaceId_email: { workspaceId: workspace.id, email: command.email } },
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
          invitedById: userId,
          expiresAt: new Date(now + INVITE_TTL),
          acceptedAt: null,
          updatedAt: new Date(now),
        }
        await tx.workspaceInvitation.upsert({
          where: { workspaceId_email: { workspaceId: workspace.id, email: command.email } },
          create: { id: randomUUID(), workspaceId: workspace.id, email: command.email, ...values },
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
}

export async function readInvitation(token: string) {
  if (!SHARE_TOKEN.test(token)) return null
  const invite = await getDb().workspaceInvitation.findUnique({
    where: { tokenHash: hash(token) },
    include: { workspace: { select: { id: true, name: true } } },
  })
  if (!invite || invite.expiresAt <= new Date()) return null
  return {
    workspaceId: invite.workspace.id,
    workspaceName: invite.workspace.name,
    email: invite.email,
    role: invite.role,
  }
}

export async function acceptInvitation(userId: string, token: string, language: Language = "en") {
  if (!SHARE_TOKEN.test(token)) throw new NotFoundError()
  return getDb().$transaction(async (tx) => {
    const candidate = await tx.workspaceInvitation.findUnique({
      where: { tokenHash: hash(token) },
    })
    if (!candidate) throw new NotFoundError()
    // Lock the workspace first, then the invitation, like every other writer.
    const [workspace] = await tx.$queryRaw<{ id: string }[]>`
      select id from workspaces where id = ${candidate.workspaceId} for update`
    if (!workspace) throw new NotFoundError()
    const [invite] = await tx.$queryRaw<
      { id: string; email: string; role: WorkspaceRole; expiresAt: Date; acceptedAt: Date | null }[]
    >`select id, email, role::text as role, expires_at as "expiresAt", accepted_at as "acceptedAt"
      from workspace_invitations where id = ${candidate.id} for update`
    if (!invite || invite.expiresAt < new Date()) throw new NotFoundError()
    const recipient = await tx.user.findUnique({ where: { id: userId } })
    if (!recipient?.emailVerified || recipient.email.toLowerCase() !== invite.email)
      throw new WorkspaceError("wrongInviteAccount")
    const member = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    })
    if (invite.acceptedAt && !member) throw new NotFoundError()
    if (!invite.acceptedAt) {
      // New users get their own personal workspace next to the shared one.
      if (!(await tx.workspaceMember.count({ where: { userId } })))
        await createWorkspace(tx, userId, randomUUID(), translate(language, "personalWorkspace"), language)
      if (!member)
        await tx.workspaceMember.create({
          data: { id: randomUUID(), workspaceId: workspace.id, userId, role: invite.role },
        })
      await tx.workspaceInvitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      })
    }
    const members = await tx.workspaceMember.findMany({
      where: { workspaceId: workspace.id },
      select: { userId: true },
    })
    return { workspaceId: workspace.id, recipients: members.map((m) => m.userId) }
  })
}
