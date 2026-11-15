import { getDb } from "@even/db"
import { mailChannel, ping, userChannel } from "@even/realtime/server"

export { mailChannel, realtimeEnabled, sealChannel, userChannel } from "@even/realtime/server"

/** Tells a user's open tabs to refetch. Carries no mail data. */
export async function notifyMailChanged(userId: string) {
  await ping([mailChannel(userId)])
}

/** Tells the open tabs of everyone who has this mailbox in a list to refetch. */
export async function notifyMailboxChanged(accountId: string) {
  const rows = await getDb().mailConnection.findMany({ where: { accountId }, distinct: ["userId"], select: { userId: true } })
  if (rows.length > 0) await ping(rows.map((row) => mailChannel(row.userId)))
}

/** Tell every affected user's open clients to refetch. Carries no data. */
export async function notifyWorkspaceUsers(userIds: string[]) {
  await ping(userIds.map(userChannel))
}
