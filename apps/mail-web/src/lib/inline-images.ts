import type { MailInlineUpload } from "@evido/mail-core/types"

/** Wide enough for any mail client, small enough to keep messages light. */
const MAX_WIDTH = 1200
/** Below this a picture is kept exactly as it is. */
const KEEP_BYTES = 300 * 1024
const DATA_URL = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/**
 * A pasted or dropped picture as a data URL the editor can show. Large photos are
 * scaled down and re-encoded; small ones and animations stay as they are.
 */
export async function prepareImage(file: File): Promise<{ src: string; width: number }> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  if (file.type === "image/gif" || (file.size <= KEEP_BYTES && width <= MAX_WIDTH)) {
    bitmap.close()
    return { src: await readAsDataUrl(file), width }
  }
  const scale = Math.min(1, MAX_WIDTH / width)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  // PNG keeps transparency for logos and screenshots; photos are far smaller as JPEG.
  const type = file.type === "image/png" ? "image/png" : "image/jpeg"
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
  if (!blob) throw new Error("Image could not be encoded")
  return { src: await readAsDataUrl(blob), width: canvas.width }
}

/** FNV-1a: a stable id for the same picture, so saving a draft again keeps its ids. */
function hash(value: string) {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return (result >>> 0).toString(36)
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }

// Hashing a large picture on every keystroke would be slow.
const known = new Map<string, MailInlineUpload>()

function uploadFor(src: string): MailInlineUpload | null {
  const cached = known.get(src)
  if (cached) return cached
  const match = DATA_URL.exec(src)
  if (!match) return null
  const [, contentType = "", data = ""] = match
  const contentId = `${hash(src)}.${src.length.toString(36)}@evido`
  const upload = { contentId, name: `image-${hash(src)}.${EXTENSIONS[contentType] ?? "img"}`, contentType, data }
  if (known.size > 200) known.clear()
  known.set(src, upload)
  return upload
}

/**
 * Mail clients block `data:` pictures, so each one goes along as an inline file
 * and the HTML refers to it by content id.
 */
export function toInlineImages(html: string): { html: string; inline: MailInlineUpload[] } {
  if (!html.includes("data:image/")) return { html, inline: [] }
  const template = document.createElement("template")
  template.innerHTML = html
  const inline = new Map<string, MailInlineUpload>()
  template.content.querySelectorAll("img").forEach((image) => {
    const upload = uploadFor(image.getAttribute("src") ?? "")
    if (!upload) return
    inline.set(upload.contentId, upload)
    image.setAttribute("src", `cid:${upload.contentId}`)
  })
  const container = document.createElement("div")
  container.append(template.content)
  return { html: container.innerHTML, inline: [...inline.values()] }
}

/** The other way, for a saved draft: `cid:` links become pictures the editor can show. */
export function fromInlineImages(html: string, inline: MailInlineUpload[] = []) {
  if (inline.length === 0) return html
  const byId = new Map(inline.map((image) => [image.contentId, image]))
  const template = document.createElement("template")
  template.innerHTML = html
  template.content.querySelectorAll("img").forEach((image) => {
    const id = image.getAttribute("src")?.replace(/^cid:/i, "")
    const found = id ? byId.get(id) : undefined
    if (found) image.setAttribute("src", `data:${found.contentType};base64,${found.data}`)
  })
  const container = document.createElement("div")
  container.append(template.content)
  return container.innerHTML
}

export const uploadBytes = (files: { data: string }[]) =>
  files.reduce((sum, file) => sum + file.data.length, 0) * 0.75
