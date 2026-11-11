import { describe, expect, it } from "vitest"
import { parseListUnsubscribe } from "../src/unsubscribe"

describe("parseListUnsubscribe", () => {
  it("reads one-click unsubscribing", () => {
    expect(
      parseListUnsubscribe("<https://list.example.com/u?id=1>, <mailto:u@list.example.com?subject=stop>", "List-Unsubscribe=One-Click")
    ).toEqual({
      url: "https://list.example.com/u?id=1",
      mailto: { address: "u@list.example.com", subject: "stop", body: "unsubscribe" },
      oneClick: true,
    })
  })

  it("is not one-click without the Post header", () => {
    expect(parseListUnsubscribe("<https://list.example.com/u>")).toMatchObject({ oneClick: false })
  })

  it("takes a mailbox alone", () => {
    expect(parseListUnsubscribe("<mailto:leave@list.example.com>")).toEqual({
      url: null,
      mailto: { address: "leave@list.example.com", subject: "unsubscribe", body: "unsubscribe" },
      oneClick: false,
    })
  })

  it.each([
    ["no header", undefined],
    ["plain http", "<http://list.example.com/u>"],
    ["a script link", "<javascript:alert(1)>"],
    ["no brackets", "https://list.example.com/u"],
  ])("offers nothing for %s", (_name, header) => {
    expect(parseListUnsubscribe(header)).toBeNull()
  })
})
