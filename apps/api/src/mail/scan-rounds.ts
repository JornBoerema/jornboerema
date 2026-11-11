/**
 * Reads conversations until the deadline: one at a time per mailbox, as
 * providers slow down a mailbox asked several things at once, and the
 * mailboxes side by side. One that fails doesn't hold up the others; it is
 * tried again next time.
 */
export async function readInRounds<T>(
  items: T[],
  deadline: number,
  mailboxOf: (item: T) => string,
  read: (item: T) => Promise<void>,
  what: string
): Promise<{ done: boolean; read: number }> {
  const lanes = new Map<string, T[]>()
  for (const item of items) {
    const lane = lanes.get(mailboxOf(item))
    if (lane) lane.push(item)
    else lanes.set(mailboxOf(item), [item])
  }
  let handled = 0
  await Promise.all(
    [...lanes.values()].map(async (lane) => {
      for (const item of lane) {
        if (Date.now() > deadline) return
        try {
          await read(item)
        } catch (error) {
          console.error(`${what} scan failed for a conversation`, error)
        }
        handled += 1
      }
    })
  )
  return { done: handled === items.length, read: handled }
}
