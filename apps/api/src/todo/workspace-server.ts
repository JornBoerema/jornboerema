import { getDb, Prisma, type Tx } from "@evido/db"
import { KeyedError } from "../i18n"
import {
  moveTodo,
  reorderIds,
  taskStatus,
  taskStatePatch,
  type Command,
  type Todo,
  type WorkspaceData,
} from "@evido/todo-core/workspace"

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
}
function toTodo(todo: TodoRow): Todo {
  return { ...todo, createdAt: todo.createdAt.toISOString() }
}

export async function readLinkedWorkspace(token: string): Promise<WorkspaceData> {
  if (!SHARE_TOKEN.test(token)) throw new NotFoundError()
  return getDb().$transaction(
    async (tx) => {
      const shared = await tx.listLink.findUnique({
        where: { token },
        include: { list: { include: { todos: true } } },
      })
      if (!shared) throw new NotFoundError()
      const { list } = shared
      return {
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
        todos: list.todos.map(toTodo),
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
        include: { todos: true },
      })
      return {
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
        todos: lists.flatMap((l) => l.todos.map(toTodo)),
      }
    },
    { isolationLevel: "RepeatableRead" }
  )
}

type LockedList = {
  id: string
  workspaceId: string
  kind: "todo" | "note"
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
  command: Command
): Promise<string[]> {
  const userId = typeof actor === "string" ? actor : null
  const shareToken = typeof actor === "string" ? null : actor.shareToken
  if (shareToken !== null && !SHARE_TOKEN.test(shareToken)) throw new NotFoundError()
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
      return recipients
    })
  }
  return getDb().$transaction(async (tx) => {
    let listId: string
    if (command.type === "create-todo" || command.type === "clear-done") listId = command.listId
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
        const current = (await tx.todo.findMany({ where: { listId } })).map(toTodo)
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
        await tx.todo.create({
          data: {
            id: command.id,
            listId,
            title: command.title,
            position: Math.min(0, minimum._min.position ?? 0) - 1,
          },
        })
        changed = 1
        break
      }
      case "update-todo":
        changed = (
          await tx.todo.updateMany({
            where: { id: command.id, listId },
            data: {
              ...(command.title !== undefined ? { title: command.title } : {}),
              ...taskStatePatch(command),
            },
          })
        ).count
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
