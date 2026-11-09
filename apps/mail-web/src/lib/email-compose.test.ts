// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { toEmailHtml } from "./email-compose"

const body = (html: string) => new DOMParser().parseFromString(toEmailHtml(html), "text/html").body

describe("toEmailHtml", () => {
  it("removes the paragraphs the editor puts inside list items", () => {
    expect(body("<ul><li><p>One</p></li></ul>").querySelector("li")?.innerHTML).toBe("One")
  })

  it("puts spacing on the elements, where mail clients read it", () => {
    expect(body("<p>Hi</p>").querySelector("p")?.getAttribute("style")).toContain("margin")
  })

  it("keeps empty lines visible", () => {
    expect(body("<p></p>").querySelector("p br")).not.toBeNull()
  })

  it("keeps inline formatting and links", () => {
    const result = body('<p><strong>a</strong> <a href="https://x.nl">b</a></p>')
    expect(result.querySelector("strong")?.textContent).toBe("a")
    expect(result.querySelector("a")?.getAttribute("href")).toBe("https://x.nl")
  })
})
