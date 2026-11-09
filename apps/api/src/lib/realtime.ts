import { Rest } from "ably"

let client: Rest | undefined
export function getRealtime() {
  if (!process.env.ABLY_API_KEY) throw new Error("ABLY_API_KEY ontbreekt.")
  return (client ??= new Rest(process.env.ABLY_API_KEY))
}
export const userChannel = (userId: string) => `workspace:${userId}`
export const mailChannel = (userId: string) => `mail:${userId}`

/** Tells a user's open tabs to refetch. Carries no mail data. */
export async function notifyMailChanged(userId: string) {
  if (!process.env.ABLY_API_KEY) return
  await getRealtime().channels.get(mailChannel(userId)).publish("changed", { at: Date.now() })
}

/** Tell every affected user's open clients to refetch. Messages carry no data. */
export async function notifyWorkspaceUsers(userIds: string[]) {
  if (!process.env.ABLY_API_KEY) return
  const results = await Promise.allSettled(
    [...new Set(userIds)].map((id) =>
      getRealtime().channels.get(userChannel(id)).publish("changed", { at: Date.now() })
    )
  )
  if (results.some((r) => r.status === "rejected"))
    console.error("Realtime notification failed; clients will reconcile on polling/reconnect.")
}
