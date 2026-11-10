import { describe, expect, it } from "vitest"
import { parseWritten } from "../src/write"

describe("parseWritten", () => {
  it("takes a subject line off the top", () => {
    expect(parseWritten("Subject: Kapotte ketel\n\nBeste verhuurder,\n\nDe ketel is kapot.")).toEqual({
      subject: "Kapotte ketel",
      text: "Beste verhuurder,\n\nDe ketel is kapot.",
    })
  })

  it("holds the body back while the first line may still be a subject", () => {
    expect(parseWritten("Subj", { done: false })).toEqual({ subject: null, text: "" })
    expect(parseWritten("Subject: Ket", { done: false })).toEqual({ subject: null, text: "" })
    expect(parseWritten("Subject: Ketel\n\nBes", { done: false })).toEqual({ subject: "Ketel", text: "Bes" })
  })

  it("streams a body without a subject straight away", () => {
    expect(parseWritten("Hoi Piet,\n\nDonder", { done: false })).toEqual({ subject: null, text: "Hoi Piet,\n\nDonder" })
    expect(parseWritten("S", { done: true })).toEqual({ subject: null, text: "S" })
  })

  it("drops markdown a mail has no use for", () => {
    expect(parseWritten("```\nHi **there**\n\n\n\nBye\n```")).toEqual({ subject: null, text: "Hi there\n\nBye" })
  })
})
