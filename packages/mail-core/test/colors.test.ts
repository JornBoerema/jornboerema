import { describe, expect, it } from "vitest"
import { firstFreeColor, MAIL_ACCOUNT_COLORS } from "../src/types"

describe("firstFreeColor", () => {
  it("starts at the first colour", () => {
    expect(firstFreeColor([])).toBe(0)
  })

  it("fills the gap a disconnected mailbox leaves", () => {
    expect(firstFreeColor([0, 2, 3])).toBe(1)
  })

  it("reuses the least used colour once all are taken", () => {
    const all = Array.from({ length: MAIL_ACCOUNT_COLORS }, (_, color) => color)
    expect(firstFreeColor([...all, ...all.filter((color) => color !== 4)])).toBe(4)
  })
})
