import { randomUUID } from "node:crypto"
import { getDb } from "@even/db"
import { notifyMailChanged } from "../lib/realtime"
import { listThreads, type Conversation } from "./threads-server"
import type { MailViewer } from "./accounts-server"

/** At most this many on top; more would push the inbox itself out of sight. */
const MAX_PINS = 50

/** The pinned conversations still in the inbox, newest first, as list lines. */
export async function listPins(viewer: MailViewer, accountId?: string) {
  const { threads } = await listThreads(viewer, { accountId, pinnedOnly: true, limit: MAX_PINS })
  return threads
}

/** Pins are the viewer's own, also in a mailbox someone else has too. */
export async function pin({ account, threadId, userId }: Conversation, pinned: boolean) {
  const db = getDb()
  if (pinned)
    await db.mailPin.upsert({
      where: { userId_accountId_threadId: { userId, accountId: account.id, threadId } },
      create: { id: randomUUID(), userId, accountId: account.id, threadId },
      update: {},
    })
  else await db.mailPin.deleteMany({ where: { userId, accountId: account.id, threadId } })
  // Other devices move it too.
  await notifyMailChanged(userId).catch(() => undefined)
  return { pinned }
}
