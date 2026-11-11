// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { buildEmailDocument, hasOwnBackground, hasRemoteImages, sanitizeEmail, withoutQuote } from "./email-html"

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

describe("hasOwnBackground", () => {
  it.each([
    ["plain text", `<p style="color:#333">Hi</p>`],
    ["white paper", `<body style="background:#ffffff"><table bgcolor="white"><tr><td>Hi</td></tr></table></body>`],
    ["transparent", `<div style="background-color: transparent !important">Hi</div>`],
  ])("is false for %s", (_name, html) => {
    expect(hasOwnBackground(html)).toBe(false)
  })

  it.each([
    ["a coloured block", `<td style="background-color:#f07a2b">Book</td>`],
    ["a bgcolor table", `<table bgcolor="#1a1a1a"><tr><td>Hi</td></tr></table>`],
    ["a style block", `<style>.header{background:#0b5}</style>`],
    ["a background image", `<div style="background-image:url(data:image/png;base64,AA)">Hi</div>`],
  ])("is true for %s", (_name, html) => {
    expect(hasOwnBackground(html)).toBe(true)
  })
})

describe("dark plain mail", () => {
  it("drops the white paper only when asked", () => {
    expect(buildEmailDocument("<p>hi</p>", false)).not.toContain("color-scheme:dark")
    expect(buildEmailDocument("<p>hi</p>", false, true)).toContain("color-scheme:dark")
  })
})

describe("withoutQuote", () => {
  it("cuts a Gmail quote with its attribution", () => {
    const html = `<div dir="ltr">Thanks!</div><br><div class="gmail_quote"><div class="gmail_attr">On Wed, X wrote:</div><blockquote>old</blockquote></div>`
    const result = withoutQuote(html)
    expect(result).toContain("Thanks!")
    expect(result).not.toContain("old")
    expect(result).not.toContain("wrote")
  })

  it("cuts an Apple Mail quote and the line that introduces it", () => {
    const html = `<div>Sure.</div><div><br><blockquote type="cite"><div>On 6 Nov, X wrote:</div></blockquote></div>`
    expect(withoutQuote(`<div>Sure.</div><div>On 6 Nov, X wrote:</div><blockquote type="cite">old</blockquote>`)).toBe(
      "<div>Sure.</div>"
    )
    expect(withoutQuote(html)).toContain("Sure.")
    expect(withoutQuote(html)).not.toContain("wrote")
  })

  it("cuts everything after Outlook's marker, also outside its parent", () => {
    const html = `<div><p>New text</p><div id="appendonsend"></div></div><hr><div id="divRplyFwdMsg">From: X</div><div>old</div>`
    expect(withoutQuote(html)).toBe("<div><p>New text</p></div>")
  })

  it("leaves mail without a quote, or with nothing but one", () => {
    expect(withoutQuote("<p>Just this</p>")).toBeNull()
    expect(withoutQuote(`<div class="gmail_quote">old</div>`)).toBeNull()
  })
})
