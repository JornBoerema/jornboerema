import { mailChannel, ping, userChannel } from "@evido/realtime/server"

export { mailChannel, realtimeEnabled, sealChannel, userChannel } from "@evido/realtime/server"

/** Tells a user's open tabs to refetch. Carries no mail data. */
export async function notifyMailChanged(userId: string) {
  await ping([mailChannel(userId)])
}

/** Tell every affected user's open clients to refetch. Carries no data. */
export async function notifyWorkspaceUsers(userIds: string[]) {
  await ping(userIds.map(userChannel))
}
