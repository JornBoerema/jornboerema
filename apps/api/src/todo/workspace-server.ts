import { getDb, Prisma, type Tx } from "@evido/db"
import { env } from "../env"
import { KeyedError } from "../i18n"
import {
  moveTodo,
  reorderIds,
  taskStatus,
  taskStatePatch,
  moveIssue,
  type Command,
  type Todo,
  type WorkspaceData,
} from "@evido/todo-core/workspace"
import { statusForFlags } from "@evido/todo-core/board"
import {
  ensureStatuses,
  executeBoardSettings,
  isBoardSettingsCommand,
  readStatuses,
  startStatus,
  flagsFor,
} from "./board-server"
import type { Language } from "@evido/i18n"

export class NotFoundError extends Error {}
/** Message is a translation key (see ../i18n.ts). */
export class InvalidCommandError extends KeyedError {}
export class NoteConflictError extends KeyedError {}

export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/

type TodoRow = {
  id: string
  listId: string
  title: string
  completed: boolean
  inProgress: boolean
  position: number
  createdAt: Date
  number?: number | null
  description?: string
  statusId?: string | null
  projectId?: string | null
  priority?: number
  parentId?: string | null
  assignees?: { userId: string }[]
  attachments?: { id: string; name: string; contentType: string; size: number; createdAt: Date }[]
}

/** What readers include for each todo: its mail, and on boards its people and files. */
const todoInclude = {
  mail: true,
  assignees: { select: { userId: true } },
  attachments: {
    where: { complete: true },
    orderBy: { createdAt: "asc" as const },
    select: { id: true, name: true, contentType: true, size: true, createdAt: true },
  },
}
type MailRow = {
  userId: string
  accountId: string
  threadId: string
  subject: string
  fromName: string | null
  fromEmail: string | null
}

/** Where a mail opens in Even mailen: by mailbox and the provider's conversation id. */
export const mailLink = (accountId: string, threadId: string, subject: string) =>
  `${env.mailWebUrl}/?${new URLSearchParams({ conversation: `${accountId}:${threadId}`, subject })}`

function toTodo(
  {
    mail,
    number,
    description,
    statusId,
    projectId,
    priority,
    parentId,
    assignees,
    attachments,
    ...todo
  }: TodoRow & { mail?: MailRow | null },
  viewer?: string
): Todo {
  // Board fields only for issues, so simple lists look exactly as before.
  const board = number != null || statusId != null
  return {
    ...todo,
    createdAt: todo.createdAt.toISOString(),
    ...(board && {
      number: number ?? undefined,
      description: description ?? "",
      statusId: statusId ?? undefined,
      projectId: projectId ?? undefined,
      priority: priority ?? 0,
      parentId: parentId ?? undefined,
      assigneeIds: assignees?.map((a) => a.userId) ?? [],
      attachments:
        attachments?.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })) ?? [],
    }),
    // Workspace members see where a task came from; only its owner can open the mail.
    ...(mail &&
      viewer && {
        mail: {
          subject: mail.subject,
          from: mail.fromName ?? mail.fromEmail,
          url: mail.userId === viewer ? mailLink(mail.accountId, mail.threadId, mail.subject) : null,
        },
      }),
  }
}

export async function readLinkedWorkspace(token: string): Promise<WorkspaceData> {
  if (!SHARE_TOKEN.test(token)) throw new NotFoundError()
  return getDb().$transaction(
    async (tx) => {
      const shared = await tx.listLink.findUnique({
        where: { token },
        include: { list: { include: { todos: { include: todoInclude } } } },
      })
      if (!shared) throw new NotFoundError()
      const { list } = shared
      const board =
        list.kind === "board"
          ? {
              statuses: await readStatuses(tx, list.workspaceId),
              projects: (
                await tx.project.findMany({
                  where: { workspaceId: list.workspaceId },
                  orderBy: [{ position: "asc" }, { createdAt: "asc" }],
                })
              ).map(({ id, name, description, color, position }) => ({ id, name, description, color, position })),
              // Who is assigned stays private; the link holder sees only that someone is.
              members: [],
            }
          : {}
      return {
        ...board,
        lists: [
          {
            id: list.id,
            name: list.name,
            kind: list.kind,
            role: shared.role,
            ...(list.kind === "note"
              ? { note: { markdown: list.noteContent, version: list.noteVersion } }
              : {}),
            createdAt: list.createdAt.toISOString(),
          },
        ],
        todos: list.todos.map(({ mail: _mail, ...todo }) => toTodo(todo)),
      }
    },
    { isolationLevel: "RepeatableRead" }
  )
}

/** Member ids of a workspace, or [] when the user is not a member. */
export async function workspaceMemberIds(tx: Tx, workspaceId: string, userId: string) {
  const members = await tx.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true },
  })
  return members.some((m) => m.userId === userId) ? members.map((m) => m.userId) : []
}

// Every member can manage every list in the workspace, so they all get "owner".
export async function readWorkspace(userId: string, workspaceId: string): Promise<WorkspaceData> {
  return getDb().$transaction(
    async (tx) => {
      if (!(await workspaceMemberIds(tx, workspaceId, userId)).length) throw new NotFoundError()
      const lists = await tx.list.findMany({
        where: { workspaceId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: { todos: { include: todoInclude } },
      })
      // One connection per transaction: these run one after another.
      const statuses = await readStatuses(tx, workspaceId)
      const projects = await tx.project.findMany({ where: { workspaceId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })
      const members = await tx.workspaceMember.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        select: { user: { select: { id: true, name: true, email: true, image: true } } },
      })
      return {
        statuses,
        projects: projects.map(({ id, name, description, color, position }) => ({ id, name, description, color, position })),
        members: members.map((m) => m.user),
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          ...(l.kind !== "todo" ? { kind: l.kind } : {}),
          ...(l.kind === "note"
            ? { note: { markdown: l.noteContent, version: l.noteVersion } }
            : {}),
          createdAt: l.createdAt.toISOString(),
          role: "owner" as const,
        })),
        todos: lists.flatMap((l) => l.todos.map((todo) => toTodo(todo, userId))),
      }
    },
    { isolationLevel: "RepeatableRead" }
  )
}

type LockedList = {
  id: string
  workspaceId: string
  kind: "todo" | "note" | "board"
  noteVersion: number
}
/** Row lock on the list serializes permission changes with writes. */
export async function lockList(tx: Tx, listId: string) {
  const [list] = await tx.$queryRaw<LockedList[]>`
    select id, workspace_id as "workspaceId", kind::text as kind, note_version as "noteVersion"
    from lists where id = ${listId} for update`
  return list
}

// Notifications include all workspace members captured before a deletion, so
// their open clients also reconcile.
export async function executeCommand(
  actor: string | { shareToken: string },
  command: Command,
  language: Language = "en"
): Promise<string[]> {
  const userId = typeof actor === "string" ? actor : null
  const shareToken = typeof actor === "string" ? null : actor.shareToken
  if (shareToken !== null && !SHARE_TOKEN.test(shareToken)) throw new NotFoundError()
  if (isBoardSettingsCommand(command)) {
    if (!userId) throw new NotFoundError()
    return getDb().$transaction((tx) => executeBoardSettings(tx, userId, command))
  }
  if (command.type === "create-list") {
    if (!userId) throw new NotFoundError()
    return getDb().$transaction(async (tx) => {
      const recipients = await workspaceMemberIds(tx, command.workspaceId, userId)
      if (!recipients.length) throw new NotFoundError()
      const kind = command.kind ?? "todo"
      // New lists go to the end of their sidebar section.
      const last = await tx.list.aggregate({
        where: { workspaceId: command.workspaceId, kind },
        _max: { position: true },
      })
      await tx.list.create({
        data: {
          position: (last._max.position ?? -1) + 1,
          id: command.id,
          workspaceId: command.workspaceId,
          userId,
          name: command.name,
          kind,
          noteContent: command.markdown ?? "",
        },
      })
      if (kind === "board") await ensureStatuses(tx, command.workspaceId, language)
      return recipients
    })
  }
  return getDb().$transaction(async (tx) => {
    let listId: string
    if (command.type === "create-todo" || command.type === "clear-done" || command.type === "create-issue")
      listId = command.listId
    else if (command.type === "delete-attachment") {
      const file = await tx.todoAttachment.findUnique({
        where: { id: command.id },
        select: { todo: { select: { listId: true } } },
      })
      if (!file) throw new NotFoundError()
      listId = file.todo.listId
    }
    else if (
      command.type === "rename-list" ||
      command.type === "delete-list" ||
      command.type === "move-list" ||
      command.type === "update-note"
    )
      listId = command.id
    else {
      const task = await tx.todo.findUnique({
        where: { id: command.id },
        select: { listId: true },
      })
      if (!task) throw new NotFoundError()
      listId = task.listId
    }
    const list = await lockList(tx, listId)
    if (!list) throw new NotFoundError()
    // Everyone in the workspace receives the change notification.
    const memberIds = await tx.workspaceMember.findMany({
      where: { workspaceId: list.workspaceId },
      select: { userId: true },
    })
    const recipients = memberIds.map((m) => m.userId)
    const isMember = userId !== null && recipients.includes(userId)
    // Recheck the link under the same list lock used by revocation.
    const link =
      shareToken === null
        ? null
        : await tx.listLink.findFirst({ where: { listId, token: shareToken } })
    const listCommand =
      command.type === "rename-list" || command.type === "delete-list" || command.type === "move-list"
    if (listCommand ? !isMember : !isMember && link?.role !== "editor") throw new NotFoundError()
    if (list.kind === "note" && !listCommand && command.type !== "update-note")
      throw new InvalidCommandError("useNoteEditor")
    const issueCommand =
      command.type === "create-issue" || command.type === "update-issue" || command.type === "move-issue"
    if (issueCommand && list.kind !== "board") throw new InvalidCommandError("notABoard")
    /** Projects and assignees must come from the board's own workspace. */
    const checkRefs = async (refs: { projectId?: string | null; assigneeIds?: string[] }) => {
      if (refs.projectId && !(await tx.project.count({ where: { id: refs.projectId, workspaceId: list.workspaceId } })))
        throw new NotFoundError()
      if (refs.assigneeIds?.some((id) => !recipients.includes(id))) throw new NotFoundError()
    }
    const nextNumber = async () =>
      ((await tx.todo.aggregate({ where: { listId }, _max: { number: true } }))._max.number ?? 0) + 1

    let changed: number
    switch (command.type) {
      case "update-note":
        if (list.kind !== "note") throw new InvalidCommandError("notANote")
        if (list.noteVersion !== command.version)
          throw new NoteConflictError("noteConflict")
        changed = (
          await tx.list.updateMany({
            where: { id: listId },
            data: { noteContent: command.markdown, noteVersion: list.noteVersion + 1 },
          })
        ).count
        break
      case "rename-list":
        changed = (
          await tx.list.updateMany({ where: { id: listId }, data: { name: command.name } })
        ).count
        break
      case "delete-list":
        changed = (await tx.list.deleteMany({ where: { id: listId } })).count
        break
      case "move-list": {
        const section = await tx.list.findMany({
          where: { workspaceId: list.workspaceId, kind: list.kind },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        })
        const ids = section.map((l) => l.id)
        if (!ids.includes(command.targetId)) throw new NotFoundError()
        const order = reorderIds(ids, command.id, command.targetId, command.placement)
        const cases = Prisma.join(
          order.map((id, position) => Prisma.sql`when ${id} then ${position}::integer`),
          " "
        )
        changed = await tx.$executeRaw`
          update lists set position = case id ${cases} else position end
          where workspace_id = ${list.workspaceId} and kind::text = ${list.kind}`
        break
      }
      case "move-todo": {
        const current = (await tx.todo.findMany({ where: { listId } })).map((todo) => toTodo(todo))
        const moving = current.find((t) => t.id === command.id)
        const target = current.find((t) => t.id === command.targetId)
        if (!moving || !target || taskStatus(moving) !== taskStatus(target))
          throw new NotFoundError()
        const reordered = moveTodo(current, command)
        const cases = Prisma.join(
          reordered.map((t) => Prisma.sql`when ${t.id} then ${t.position ?? 0}::integer`),
          " "
        )
        changed = await tx.$executeRaw`
          update todos set position = case id ${cases} else position end
          where list_id = ${listId}`
        break
      }
      case "create-todo": {
        const minimum = await tx.todo.aggregate({ where: { listId }, _min: { position: true } })
        // Added to a board from elsewhere (mail, MCP): it becomes a regular issue.
        const status = list.kind === "board" ? await startStatus(tx, list.workspaceId) : undefined
        await tx.todo.create({
          data: {
            id: command.id,
            listId,
            title: command.title,
            position: Math.min(0, minimum._min.position ?? 0) - 1,
            ...(list.kind === "board"
              ? { number: await nextNumber(), statusId: status?.id, ...flagsFor(status) }
              : {}),
          },
        })
        changed = 1
        break
      }
      case "update-todo": {
        const flags = taskStatePatch(command)
        const status =
          list.kind === "board" && flags.completed !== undefined
            ? statusForFlags(await readStatuses(tx, list.workspaceId), { completed: flags.completed, inProgress: flags.inProgress })
            : undefined
        changed = (
          await tx.todo.updateMany({
            where: { id: command.id, listId },
            data: {
              ...(command.title !== undefined ? { title: command.title } : {}),
              ...flags,
              ...(status ? { statusId: status.id, ...flagsFor(status) } : {}),
            },
          })
        ).count
        break
      }
      case "create-issue": {
        await checkRefs(command)
        const status = await startStatus(tx, list.workspaceId, command.statusId)
        if (command.parentId && !(await tx.todo.count({ where: { id: command.parentId, listId } })))
          throw new NotFoundError()
        const minimum = await tx.todo.aggregate({
          where: { listId, statusId: status?.id ?? null },
          _min: { position: true },
        })
        await tx.todo.create({
          data: {
            id: command.id,
            listId,
            title: command.title,
            description: command.description ?? "",
            number: await nextNumber(),
            statusId: status?.id,
            ...flagsFor(status),
            projectId: command.projectId ?? null,
            priority: command.priority ?? 0,
            parentId: command.parentId ?? null,
            position: Math.min(0, minimum._min.position ?? 0) - 1,
            assignees: { create: (command.assigneeIds ?? []).map((userId) => ({ userId })) },
          },
        })
        changed = 1
        break
      }
      case "update-issue": {
        await checkRefs(command)
        const status = command.statusId ? await startStatus(tx, list.workspaceId, command.statusId) : undefined
        changed = (
          await tx.todo.updateMany({
            where: { id: command.id, listId },
            data: {
              ...(command.title !== undefined ? { title: command.title } : {}),
              ...(command.description !== undefined ? { description: command.description } : {}),
              ...(status ? { statusId: status.id, ...flagsFor(status) } : {}),
              ...(command.projectId !== undefined ? { projectId: command.projectId } : {}),
              ...(command.priority !== undefined ? { priority: command.priority } : {}),
            },
          })
        ).count
        if (changed && command.assigneeIds) {
          await tx.todoAssignee.deleteMany({ where: { todoId: command.id } })
          await tx.todoAssignee.createMany({
            data: [...new Set(command.assigneeIds)].map((userId) => ({ todoId: command.id, userId })),
          })
        }
        break
      }
      case "move-issue": {
        const status = await startStatus(tx, list.workspaceId, command.statusId)
        const current = (await tx.todo.findMany({ where: { listId } })).map((todo) => toTodo(todo))
        if (command.targetId && !current.some((t) => t.id === command.targetId && t.statusId === command.statusId))
          throw new NotFoundError()
        const positions = moveIssue(current, command)
        if (!positions.size) throw new NotFoundError()
        const cases = Prisma.join(
          [...positions].map(([id, position]) => Prisma.sql`when ${id} then ${position}::integer`),
          " "
        )
        await tx.$executeRaw`
          update todos set position = case id ${cases} else position end
          where list_id = ${listId}`
        changed = (
          await tx.todo.updateMany({
            where: { id: command.id, listId },
            data: { statusId: status!.id, ...flagsFor(status) },
          })
        ).count
        break
      }
      case "delete-attachment":
        changed = (await tx.todoAttachment.deleteMany({ where: { id: command.id } })).count
        break
      case "delete-todo":
        changed = (await tx.todo.deleteMany({ where: { id: command.id, listId } })).count
        break
      case "clear-done":
        await tx.todo.deleteMany({ where: { listId, completed: true } })
        // The list exists and was checked above; nothing done is still a success.
        changed = 1
        break
    }
    if (!changed) throw new NotFoundError()
    return recipients
  })
}
