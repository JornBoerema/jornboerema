import { describe, expect, it } from "vitest"
import { joinRecipients, parseAddresses, splitRecipients, stripDisplayNames } from "./addresses"

describe("splitRecipients", () => {
  it("keeps text without a separator as the draft", () => {
    expect(splitRecipients("a@x.nl")).toEqual({ entries: [], draft: "a@x.nl" })
  })

  it.each([",", ";", " ", "\n"])("finishes an address on %j", (separator) => {
    expect(splitRecipients(`a@x.nl${separator}`)).toEqual({ entries: ["a@x.nl"], draft: "" })
  })

  it("drops duplicates", () => {
    expect(splitRecipients("a@x.nl, a@x.nl, b").entries).toEqual(["a@x.nl"])
  })
})

describe("joinRecipients", () => {
  it("round-trips through the split", () => {
    const value = joinRecipients(["a@x.nl", "b@x.nl"], "c")
    expect(splitRecipients(value)).toEqual({ entries: ["a@x.nl", "b@x.nl"], draft: "c" })
  })

  it("is what the send check reads, draft included", () => {
    expect(parseAddresses(joinRecipients(["a@x.nl"], "b@x.nl")).addresses.map((a) => a.email)).toEqual([
      "a@x.nl",
      "b@x.nl",
    ])
  })
})

describe("stripDisplayNames", () => {
  it("reduces pasted names to addresses", () => {
    const pasted = stripDisplayNames('Jan de Vries <jan@x.nl>; "Doe, Ann" <ann@x.nl>')
    expect(splitRecipients(pasted).entries).toEqual(["jan@x.nl", "ann@x.nl"])
  })
})
