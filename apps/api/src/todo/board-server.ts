import { randomUUID } from "node:crypto"
import { Prisma, type Tx } from "@evido/db"
import {
  defaultStatus,
  defaultStatuses,
  sortStatuses,
  statusFlags,
  type BoardStatus,
} from "@evido/todo-core/board"
import { reorderIds, type Command } from "@evido/todo-core/workspace"
import type { Language } from "@evido/i18n"
import { InvalidCommandError, NotFoundError } from "./workspace-server"

/** Workspace-wide board settings: statuses and projects. */
export type BoardSettingsCommand = Extract<
  Command,
  {
    type:
      | "create-status"
      | "update-status"
      | "move-status"
      | "delete-status"
      | "create-project"
      | "update-project"
      | "delete-project"
  }
>

export const isBoardSettingsCommand = (command: Command): command is BoardSettingsCommand =>
  [
    "create-status",
    "update-status",
    "move-status",
    "delete-status",
    "create-project",
    "update-project",
    "delete-project",
  ].includes(command.type)

/** Gives a workspace Linear's default statuses when it has none yet. */
export async function ensureStatuses(tx: Tx, workspaceId: string, language: Language = "en") {
  if (await tx.workspaceStatus.count({ where: { workspaceId } })) return
  await tx.workspaceStatus.createMany({
    data: defaultStatuses.map((status, index) => ({
      id: randomUUID(),
      workspaceId,
      name: status.name[language],
      category: status.category,
      color: status.color,
      position: index,
    })),
  })
}

export async function readStatuses(tx: Tx, workspaceId: string): Promise<BoardStatus[]> {
  const rows = await tx.workspaceStatus.findMany({ where: { workspaceId } })
  return sortStatuses(
    rows.map(({ id, name, category, color, position }) => ({ id, name, category, color, position }))
  )
}

export const flagsFor = (status: BoardStatus | undefined) => statusFlags(status?.category)

/** The status a new issue gets when none (or one from elsewhere) is given. */
export async function startStatus(tx: Tx, workspaceId: string, statusId?: string) {
  const statuses = await readStatuses(tx, workspaceId)
  const chosen = statusId ? statuses.find((s) => s.id === statusId) : defaultStatus(statuses)
  if (statusId && !chosen) throw new NotFoundError()
  return chosen
}

async function lockWorkspace(tx: Tx, workspaceId: string, userId: string) {
  const [workspace] = await tx.$queryRaw<{ id: string }[]>`
    select id from workspaces where id = ${workspaceId} for update`
  if (!workspace) throw new NotFoundError()
  const members = await tx.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } })
  const recipients = members.map((m) => m.userId)
  if (!recipients.includes(userId)) throw new NotFoundError()
  return recipients
}

async function workspaceOf(tx: Tx, command: BoardSettingsCommand) {
  if (command.type === "create-status" || command.type === "create-project") return command.workspaceId
  const row =
    command.type === "update-project" || command.type === "delete-project"
      ? await tx.project.findUnique({ where: { id: command.id }, select: { workspaceId: true } })
      : await tx.workspaceStatus.findUnique({ where: { id: command.id }, select: { workspaceId: true } })
  if (!row) throw new NotFoundError()
  return row.workspaceId
}

/** Every member may change the board settings, like they may manage every list. */
export async function executeBoardSettings(tx: Tx, userId: string, command: BoardSettingsCommand) {
  const workspaceId = await workspaceOf(tx, command)
  const recipients = await lockWorkspace(tx, workspaceId, userId)
  switch (command.type) {
    case "create-status": {
      const last = await tx.workspaceStatus.aggregate({
        where: { workspaceId, category: command.category },
        _max: { position: true },
      })
      await tx.workspaceStatus.create({
        data: {
          id: command.id,
          workspaceId,
          name: command.name,
          category: command.category,
          color: command.color,
          position: (last._max.position ?? -1) + 1,
        },
      })
      break
    }
    case "update-status": {
      const current = await tx.workspaceStatus.findUnique({ where: { id: command.id } })
      if (!current) throw new NotFoundError()
      const moving = command.category !== undefined && command.category !== current.category
      const last = moving
        ? await tx.workspaceStatus.aggregate({
            where: { workspaceId, category: command.category },
            _max: { position: true },
          })
        : null
      await tx.workspaceStatus.update({
        where: { id: command.id },
        data: {
          ...(command.name !== undefined ? { name: command.name } : {}),
          ...(command.color !== undefined ? { color: command.color } : {}),
          ...(moving ? { category: command.category, position: (last!._max.position ?? -1) + 1 } : {}),
        },
      })
      if (moving)
        await tx.todo.updateMany({
          where: { statusId: command.id },
          data: statusFlags(command.category),
        })
      break
    }
    case "move-status": {
      const statuses = await readStatuses(tx, workspaceId)
      const moving = statuses.find((s) => s.id === command.id)
      const target = statuses.find((s) => s.id === command.targetId)
      if (!moving || !target) throw new NotFoundError()
      if (moving.category !== target.category) throw new InvalidCommandError("checkInput")
      const order = reorderIds(
        statuses.filter((s) => s.category === moving.category).map((s) => s.id),
        command.id,
        command.targetId,
        command.placement
      )
      const cases = Prisma.join(
        order.map((id, position) => Prisma.sql`when ${id} then ${position}::integer`),
        " "
      )
      await tx.$executeRaw`
        update workspace_statuses set position = case id ${cases} else position end
        where workspace_id = ${workspaceId}`
      break
    }
    case "delete-status": {
      const statuses = await readStatuses(tx, workspaceId)
      const replacement = statuses.find((s) => s.id === command.replacementId)
      if (!statuses.some((s) => s.id === command.id) || !replacement) throw new NotFoundError()
      if (command.id === command.replacementId || statuses.length < 2)
        throw new InvalidCommandError("lastStatus")
      await tx.todo.updateMany({
        where: { statusId: command.id },
        data: { statusId: replacement.id, ...statusFlags(replacement.category) },
      })
      await tx.workspaceStatus.delete({ where: { id: command.id } })
      break
    }
    case "create-project": {
      const last = await tx.project.aggregate({ where: { workspaceId }, _max: { position: true } })
      await tx.project.create({
        data: {
          id: command.id,
          workspaceId,
          name: command.name,
          description: command.description ?? "",
          color: command.color,
          position: (last._max.position ?? -1) + 1,
        },
      })
      break
    }
    case "update-project":
      await tx.project.update({
        where: { id: command.id },
        data: {
          ...(command.name !== undefined ? { name: command.name } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
          ...(command.color !== undefined ? { color: command.color } : {}),
        },
      })
      break
    case "delete-project":
      // Issues keep existing; they just lose the project (onDelete: SetNull).
      await tx.project.delete({ where: { id: command.id } })
      break
  }
  return recipients
}
