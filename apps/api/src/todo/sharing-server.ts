import { randomBytes } from "node:crypto"
import { getDb } from "@evido/db"
import type { SharingCommand, SharingData } from "@evido/todo-core/sharing"
import { lockList, NotFoundError, workspaceMemberIds } from "./workspace-server"

// Any workspace member may create or revoke the public link of a list.
export async function readSharing(userId: string, listId: string): Promise<SharingData> {
  const list = await getDb().list.findUnique({
    where: { id: listId },
    select: { workspaceId: true, link: { select: { token: true, role: true } } },
  })
  if (!list || !(await workspaceMemberIds(getDb(), list.workspaceId, userId)).length)
    throw new NotFoundError()
  return { link: list.link }
}

export async function changeSharing(userId: string, command: SharingCommand) {
  return getDb().$transaction(async (tx) => {
    const list = await lockList(tx, command.listId)
    if (!list) throw new NotFoundError()
    const recipients = await workspaceMemberIds(tx, list.workspaceId, userId)
    if (!recipients.length) throw new NotFoundError()
    if (command.type === "enable-link")
      await tx.listLink.upsert({
        where: { listId: list.id },
        create: { listId: list.id, token: randomBytes(32).toString("base64url"), role: command.role },
        update: { role: command.role },
      })
    else await tx.listLink.deleteMany({ where: { listId: list.id } })
    return { recipients }
  })
}
