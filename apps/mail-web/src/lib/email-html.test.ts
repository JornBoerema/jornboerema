// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { buildEmailDocument, hasRemoteImages, sanitizeEmail } from "./email-html"

describe("sanitizeEmail", () => {
  it.each([
    ["script tags", `<p>hi</p><script>alert(1)</script>`, "<script"],
    ["event handlers", `<img src="x.png" onerror="alert(1)">`, "onerror"],
    ["javascript links", `<a href="javascript:alert(1)">x</a>`, "javascript:"],
    ["iframes", `<iframe src="https://evil.example"></iframe>`, "<iframe"],
    ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.example">`, "<meta"],
    ["base tags", `<base href="https://evil.example/">`, "<base"],
    ["external stylesheets", `<link rel="stylesheet" href="https://evil.example/a.css">`, "<link"],
    ["forms", `<form action="https://evil.example"><input name="password"></form>`, "<form"],
    ["svg scripts", `<svg><script>alert(1)</script></svg>`, "alert(1)"],
  ])("removes %s", (_name, input, forbidden) => {
    expect(sanitizeEmail(input).toLowerCase()).not.toContain(forbidden)
  })

  it("keeps layout styling, including a leading style block", () => {
    const clean = sanitizeEmail(`<style>p{color:red}</style><p style="margin:0">hi</p>`)
    expect(clean).toContain("<style>")
    expect(clean).toContain('style="margin:0"')
  })

  it("opens links in a new tab without leaking the referrer", () => {
    const clean = sanitizeEmail(`<a href="https://example.com">x</a>`)
    expect(clean).toContain('target="_blank"')
    expect(clean).toContain('rel="noopener noreferrer"')
  })
})

describe("buildEmailDocument", () => {
  const policyOf = (doc: string) => doc.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? ""

  it("blocks remote images until they are allowed", () => {
    expect(policyOf(buildEmailDocument("", false))).toContain("img-src data:;")
    expect(policyOf(buildEmailDocument("", true))).toContain("img-src data: https:;")
  })

  it("never allows scripts or remote styles", () => {
    const policy = policyOf(buildEmailDocument("", true))
    expect(policy).toContain("default-src 'none'")
    expect(policy).not.toContain("script-src")
    expect(policy).toContain("style-src 'unsafe-inline'")
  })

  it("puts the policy before the mail content", () => {
    const doc = buildEmailDocument("<p>mail</p>", false)
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<p>mail</p>"))
  })
})

describe("hasRemoteImages", () => {
  it("spots remote images and backgrounds only", () => {
    expect(hasRemoteImages(`<img src="https://t.example/p.gif">`)).toBe(true)
    expect(hasRemoteImages(`<div style="background:url(https://t.example/p.gif)"></div>`)).toBe(true)
    expect(hasRemoteImages(`<img src="data:image/png;base64,AA">`)).toBe(false)
    expect(hasRemoteImages(`<a href="https://example.com">x</a>`)).toBe(false)
  })
})
