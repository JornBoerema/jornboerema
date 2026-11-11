import { randomUUID } from "node:crypto"
import { getDb } from "@evido/db"
import { notifyMailChanged } from "../lib/realtime"
import { listThreads, type Conversation } from "./threads-server"

/** At most this many on top; more would push the inbox itself out of sight. */
const MAX_PINS = 50

/** The pinned conversations still in the inbox, newest first, as list lines. */
export async function listPins(userId: string, accountId?: string) {
  const { threads } = await listThreads(userId, { accountId, pinnedOnly: true, limit: MAX_PINS })
  return threads
}

export async function pin(userId: string, { account, threadId }: Conversation, pinned: boolean) {
  const db = getDb()
  if (pinned)
    await db.mailPin.upsert({
      where: { accountId_threadId: { accountId: account.id, threadId } },
      create: { id: randomUUID(), userId, accountId: account.id, threadId },
      update: {},
    })
  else await db.mailPin.deleteMany({ where: { accountId: account.id, threadId } })
  // Other devices move it too.
  await notifyMailChanged(userId).catch(() => undefined)
  return { pinned }
}
