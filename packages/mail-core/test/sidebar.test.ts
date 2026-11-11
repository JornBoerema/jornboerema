import { describe, expect, it } from "vitest"
import { DEFAULT_SIDEBAR, normalizeSidebar } from "../src/sidebar"

describe("normalizeSidebar", () => {
  it("falls back to the default", () => {
    expect(normalizeSidebar(null)).toEqual(DEFAULT_SIDEBAR)
    expect(normalizeSidebar("nope")).toEqual(DEFAULT_SIDEBAR)
  })

  it("keeps a saved order and puts places added later in their default section", () => {
    const layout = normalizeSidebar({ main: ["sent", "inbox"], more: ["starred"], hidden: ["spam"] })
    expect(layout.main.slice(0, 2)).toEqual(["sent", "inbox"])
    expect(layout.main).toContain("drafts")
    expect(layout.more).toEqual(["starred", "archive", "trash"])
    expect(layout.hidden).toEqual(["spam"])
  })

  it("drops unknown and repeated places", () => {
    const layout = normalizeSidebar({ main: ["inbox", "bogus", "inbox"], more: ["inbox"], hidden: [] })
    expect(layout.main.filter((item) => item === "inbox")).toHaveLength(1)
    expect(layout.more).not.toContain("inbox")
  })

  it("never hides the inbox", () => {
    const layout = normalizeSidebar({ main: [], more: [], hidden: ["inbox"] })
    expect(layout.hidden).not.toContain("inbox")
    expect(layout.main[0]).toBe("inbox")
  })
})
