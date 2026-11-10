// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { INLINE_CONTENT_ID } from "@evido/mail-core/types"
import { fromInlineImages, toInlineImages, uploadBytes } from "./inline-images"

const png = "data:image/png;base64,iVBORw0KGgo="
const jpg = "data:image/jpeg;base64,/9j/4AAQ"

describe("inline images", () => {
  it("turn data pictures into cid links with files", () => {
    const { html, inline } = toInlineImages(`<p>Hi <img src="${png}"> <img src="${jpg}"> <img src="${png}"></p>`)
    expect(inline).toHaveLength(2)
    expect(inline.every((image) => INLINE_CONTENT_ID.test(image.contentId))).toBe(true)
    expect(inline[0]).toMatchObject({ contentType: "image/png", data: "iVBORw0KGgo=" })
    expect(html).not.toContain("data:")
    expect(html.match(/cid:/g)).toHaveLength(3)
  })

  it("keep the same id for the same picture", () => {
    expect(toInlineImages(`<img src="${png}">`).inline[0]?.contentId).toBe(
      toInlineImages(`<p><img src="${png}"></p>`).inline[0]?.contentId
    )
  })

  it("leave web pictures and anything else alone", () => {
    const html = '<p><img src="https://example.com/a.png"><img src="data:text/html;base64,PGI+"></p>'
    expect(toInlineImages(html)).toEqual({ html, inline: [] })
  })

  it("come back as pictures when a draft opens", () => {
    const { html, inline } = toInlineImages(`<p><img src="${png}"></p>`)
    expect(fromInlineImages(html, inline)).toBe(`<p><img src="${png}"></p>`)
    expect(uploadBytes(inline)).toBe(9)
  })
})
