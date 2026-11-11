import { getDb } from "@evido/db"
import type { MailTodoList, MailTodoView } from "@evido/mail-core/types"
import { env } from "../env"
import { notifyWorkspaceUsers } from "../lib/realtime"
import { executeCommand, NotFoundError } from "../todo/workspace-server"
import { readConversation, type Conversation } from "./threads-server"

export class TodoListGoneError extends Error {}

const todoUrl = (workspaceId: string, listId: string) =>
  `${env.todoWebUrl}/?${new URLSearchParams({ workspace: workspaceId, list: listId })}`

/** Every task list the user can add to, workspace by workspace, as Even doen orders them. */
export async function todoLists(userId: string): Promise<MailTodoList[]> {
  const memberships = await getDb().workspaceMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      workspace: {
        include: {
          lists: {
            where: { kind: "todo" },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: { id: true, name: true },
          },
        },
      },
    },
  })
  return memberships.flatMap(({ workspace }) =>
    workspace.lists.map((list) => ({ id: list.id, name: list.name, workspaceId: workspace.id, workspaceName: workspace.name }))
  )
}

/** Who and what the conversation is about, from the synced rows or else from the provider. */
async function aboutConversation({ account, threadId }: Conversation) {
  const newest = await getDb().mailMessage.findFirst({
    where: { accountId: account.id, threadId },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { subject: true, fromName: true, fromEmail: true },
  })
  if (newest) return newest
  const { messages } = await readConversation({ account, threadId }, { includeHidden: true })
  const last = messages.at(-1)
  return { subject: last?.subject ?? "", fromName: last?.from?.name ?? null, fromEmail: last?.from?.email ?? null }
}

/** A task in Even doen, linked to this conversation. */
export async function createTodoFromMail(
  userId: string,
  conversation: Conversation,
  input: { listId: string; title: string }
): Promise<MailTodoView> {
  const db = getDb()
  const list = await db.list.findFirst({
    where: { id: input.listId, kind: "todo", workspace: { members: { some: { userId } } } },
    select: { id: true, name: true, workspaceId: true },
  })
  if (!list) throw new TodoListGoneError()
  const about = await aboutConversation(conversation)
  const id = crypto.randomUUID()
  try {
    const recipients = await executeCommand(userId, { type: "create-todo", id, listId: list.id, title: input.title })
    await db.todoMail.create({
      data: {
        todoId: id,
        userId,
        accountId: conversation.account.id,
        threadId: conversation.threadId,
        subject: about.subject.slice(0, 500),
        fromName: about.fromName,
        fromEmail: about.fromEmail,
      },
    })
    await notifyWorkspaceUsers(recipients).catch(() => undefined)
  } catch (error) {
    if (error instanceof NotFoundError) throw new TodoListGoneError()
    throw error
  }
  return { id, title: input.title, completed: false, inProgress: false, listName: list.name, url: todoUrl(list.workspaceId, list.id) }
}

/** The tasks made from this conversation that the user can still see. */
export async function todosForConversation(userId: string, { account, threadId }: Conversation): Promise<MailTodoView[]> {
  const rows = await getDb().todoMail.findMany({
    where: { accountId: account.id, threadId, todo: { list: { workspace: { members: { some: { userId } } } } } },
    orderBy: { createdAt: "asc" },
    include: { todo: { include: { list: { select: { name: true, workspaceId: true } } } } },
  })
  return rows.map(({ todo }) => ({
    id: todo.id,
    title: todo.title,
    completed: todo.completed,
    inProgress: todo.inProgress,
    listName: todo.list.name,
    url: todoUrl(todo.list.workspaceId, todo.listId),
  }))
}
