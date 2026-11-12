// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it } from "vitest"
import { clearMailCache, persistMailCache, readStoredThread, setMailStorage, type MailStorage } from "./cache"

/** The desktop database, in memory. */
function memoryDisk() {
  const items = new Map<string, string>()
  const threads = new Map<string, string>()
  const disk: MailStorage = {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
    getThread: async (user, id) => threads.get(`${user}/${id}`) ?? null,
    putThread: async (user, id, value) => void threads.set(`${user}/${id}`, value),
    clear: async () => {
      items.clear()
      threads.clear()
    },
  }
  return { disk, items, threads }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("the desktop mail cache", () => {
  beforeEach(() => localStorage.clear())

  it("moves an earlier localStorage cache over once", async () => {
    const { disk, items } = memoryDisk()
    setMailStorage(disk)
    const client = new QueryClient()
    const old = new QueryClient()
    old.setQueryData(["mail-accounts"], [{ id: "a1" }])
    // What an earlier version left behind, written the way it wrote it.
    localStorage.setItem(
      "evido.mail.cache.u1",
      JSON.stringify({
        buster: "1",
        timestamp: Date.now(),
        clientState: {
          mutations: [],
          queries: [
            {
              queryKey: ["mail-accounts"],
              queryHash: '["mail-accounts"]',
              state: { data: [{ id: "a1" }], dataUpdatedAt: Date.now(), status: "success", fetchStatus: "idle" },
            },
          ],
        },
      })
    )
    const { restored, unsubscribe } = persistMailCache(client, "u1")
    await restored
    expect(client.getQueryData(["mail-accounts"])).toEqual([{ id: "a1" }])
    expect(items.has("evido.mail.cache.u1")).toBe(true)
    expect(localStorage.getItem("evido.mail.cache.u1")).toBeNull()
    unsubscribe()
  })

  it("keeps fetched conversations and reads them back, but not hand-made edits", async () => {
    const { disk, threads } = memoryDisk()
    setMailStorage(disk)
    const client = new QueryClient()
    const { restored, unsubscribe } = persistMailCache(client, "u1")
    await restored
    await client.fetchQuery({ queryKey: ["mail-thread", "t1"], queryFn: async () => ({ messages: [{ id: "m1" }] }) })
    client.setQueryData(["mail-thread", "t2"], { messages: [] })
    await settle()
    expect(threads.has("u1/t1")).toBe(true)
    expect(threads.has("u1/t2")).toBe(false)
    expect(await readStoredThread("t1")).toEqual({ messages: [{ id: "m1" }] })
    expect(await readStoredThread("missing")).toBeNull()
    unsubscribe()
  })

  it("forgets everything on signing out", async () => {
    const { disk, items, threads } = memoryDisk()
    setMailStorage(disk)
    const client = new QueryClient()
    const { restored, unsubscribe } = persistMailCache(client, "u1")
    await restored
    await client.fetchQuery({ queryKey: ["mail-thread", "t1"], queryFn: async () => ({ messages: [] }) })
    await settle()
    items.set("evido.mail.cache.u1", "{}")
    localStorage.setItem("evido.mail.cache.u1", "{}")
    unsubscribe()
    await clearMailCache()
    expect(items.size).toBe(0)
    expect(threads.size).toBe(0)
    expect(localStorage.getItem("evido.mail.cache.u1")).toBeNull()
    expect(await readStoredThread("t1")).toBeNull()
  })
})
