import { randomUUID } from "node:crypto"
import { getDb, type Tx } from "@evido/db"
import { ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES } from "@evido/todo-core/board"
import { InvalidCommandError, NotFoundError, SHARE_TOKEN, lockList } from "./workspace-server"

/** Files whose upload never finished are dropped after this. */
const KEEP_INCOMPLETE_MS = 24 * 60 * 60 * 1000

const chunkCount = (size: number) => Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_BYTES))

/** Members of the issue's workspace; returns them so they can be notified. */
async function membersFor(tx: Tx, todoId: string, userId: string) {
  const todo = await tx.todo.findUnique({ where: { id: todoId }, select: { listId: true } })
  if (!todo) throw new NotFoundError()
  const list = await lockList(tx, todo.listId)
  if (!list || list.kind !== "board") throw new NotFoundError()
  const members = await tx.workspaceMember.findMany({
    where: { workspaceId: list.workspaceId },
    select: { userId: true },
  })
  const recipients = members.map((m) => m.userId)
  if (!recipients.includes(userId)) throw new NotFoundError()
  return recipients
}

export async function createAttachment(
  userId: string,
  file: { todoId: string; name: string; contentType: string; size: number }
) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new InvalidCommandError("attachmentTooLarge")
  return getDb().$transaction(async (tx) => {
    await membersFor(tx, file.todoId, userId)
    const id = randomUUID()
    await tx.todoAttachment.create({
      data: { id, todoId: file.todoId, userId, name: file.name, contentType: file.contentType, size: file.size },
    })
    return { id, chunkBytes: ATTACHMENT_CHUNK_BYTES }
  })
}

/** Chunks may arrive in any order and be sent again; only the uploader may send them. */
export async function putAttachmentChunk(userId: string, id: string, index: number, bytes: Uint8Array) {
  const db = getDb()
  const file = await db.todoAttachment.findFirst({ where: { id, userId, complete: false }, select: { size: true } })
  if (!file) throw new NotFoundError()
  const chunks = chunkCount(file.size)
  const expected = index === chunks - 1 ? file.size - index * ATTACHMENT_CHUNK_BYTES : ATTACHMENT_CHUNK_BYTES
  if (index < 0 || index >= chunks || bytes.length !== expected)
    throw new InvalidCommandError("attachmentIncomplete")
  await db.todoAttachmentChunk.upsert({
    where: { attachmentId_index: { attachmentId: id, index } },
    create: { attachmentId: id, index, data: Buffer.from(bytes) },
    update: { data: Buffer.from(bytes) },
  })
}

/** Shows the file on the issue once every chunk is there. */
export async function completeAttachment(userId: string, id: string) {
  return getDb().$transaction(async (tx) => {
    const file = await tx.todoAttachment.findFirst({ where: { id, userId }, select: { todoId: true, size: true } })
    if (!file) throw new NotFoundError()
    const recipients = await membersFor(tx, file.todoId, userId)
    const chunks = await tx.todoAttachmentChunk.count({ where: { attachmentId: id } })
    if (chunks !== chunkCount(file.size)) throw new InvalidCommandError("attachmentIncomplete")
    await tx.todoAttachment.update({ where: { id }, data: { complete: true } })
    return recipients
  })
}

/** Workspace members, or anyone with the board's share link, may download. */
export async function readAttachment(actor: { userId: string } | { shareToken: string }, id: string) {
  if ("shareToken" in actor && !SHARE_TOKEN.test(actor.shareToken)) throw new NotFoundError()
  const db = getDb()
  const file = await db.todoAttachment.findFirst({
    where: {
      id,
      complete: true,
      todo: {
        list:
          "userId" in actor
            ? { workspace: { members: { some: { userId: actor.userId } } } }
            : { link: { token: actor.shareToken } },
      },
    },
    include: { chunks: { orderBy: { index: "asc" } } },
  })
  if (!file) throw new NotFoundError()
  return {
    name: file.name,
    contentType: file.contentType,
    bytes: Buffer.concat(file.chunks.map((chunk) => Buffer.from(chunk.data))),
  }
}

/** Run daily: uploads that were started but never finished. */
export async function dropIncompleteAttachments() {
  const { count } = await getDb().todoAttachment.deleteMany({
    where: { complete: false, createdAt: { lt: new Date(Date.now() - KEEP_INCOMPLETE_MS) } },
  })
  return count
}
