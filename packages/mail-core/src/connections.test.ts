import { describe, expect, it } from "vitest"
import { bookableFiles, likeliestInvoiceFile } from "./connections"

const file = (name: string, contentType: string, size = 50_000) => ({ name, contentType, size })

describe("bookableFiles", () => {
  it("keeps PDFs and drops pictures when there is a PDF", () => {
    expect(bookableFiles([file("logo.png", "image/png"), file("factuur.pdf", "application/pdf")]).map((f) => f.name)).toEqual(["factuur.pdf"])
  })
  it("takes a photographed receipt when there is no PDF, but no tiny logos", () => {
    expect(bookableFiles([file("logo.png", "image/png", 4_000), file("bon.jpg", "image/jpeg")]).map((f) => f.name)).toEqual(["bon.jpg"])
  })
  it("recognises a PDF by its name when the type is generic", () => {
    expect(bookableFiles([file("INV-123.PDF", "application/octet-stream")])).toHaveLength(1)
  })
})

describe("likeliestInvoiceFile", () => {
  it("prefers the invoice over terms and conditions", () => {
    const files = [file("algemene-voorwaarden.pdf", "application/pdf"), file("Factuur 2026-014.pdf", "application/pdf")]
    expect(likeliestInvoiceFile(files)?.name).toBe("Factuur 2026-014.pdf")
  })
  it("keeps the first (newest) file when names say nothing", () => {
    expect(likeliestInvoiceFile([file("a.pdf", "application/pdf"), file("b.pdf", "application/pdf")])?.name).toBe("a.pdf")
  })
})
