import DOMPurify from "dompurify"

// Links leave the sandbox in a new tab and tell the destination nothing about us.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank")
    node.setAttribute("rel", "noopener noreferrer")
  }
})

/** Removes anything from untrusted mail HTML that could run or impersonate the app. */
export function sanitizeEmail(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Without this the parser drops <style> blocks at the start of a message.
    FORCE_BODY: true,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option"],
  })
}

export const hasRemoteImages = (sanitizedHtml: string) =>
  /<img[^>]+src=["']?https?:|url\(\s*["']?https?:/i.test(sanitizedHtml)

/**
 * The frame grows to its content and never scrolls itself, so scrolling always
 * moves the conversation. Mail often sets html and body to 100% high, which
 * would pin them to the frame; important keeps them sized by their content.
 * Mail wider than the pane scrolls sideways inside its own wrapper.
 */
// Wraps sanitized mail in a document for a sandboxed iframe. The policy is a
// second line of defence: it still blocks scripts and remote loading if a
// sanitizer bug ever lets something through.
const FRAME_STYLE = [
  "html,body{margin:0;background:#fff;color:#111;height:auto!important;min-height:0!important;overflow:hidden!important}",
  "body{padding:12px;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}",
  "#evido-mail{overflow-x:auto;overflow-y:hidden}",
  "img{max-width:100%;height:auto}",
].join("")

/** Backgrounds that don't make a design: what a plain message on white paper sets anyway. */
const PLAIN_BACKGROUND = /^(none|transparent|inherit|initial|unset|white|#fff|#ffffff|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*1(\.0*)?\s*)?\))$/i

/**
 * Whether the mail paints its own backgrounds (a newsletter, an invoice with
 * coloured blocks). Those keep their look on white paper in dark mode; plain
 * mail, which only sets text, can follow the app's dark theme.
 */
export function hasOwnBackground(sanitizedHtml: string) {
  const values = [
    ...sanitizedHtml.matchAll(/\bbgcolor\s*=\s*["']?([^"'\s>]+)/gi),
    ...sanitizedHtml.matchAll(/background(?:-color)?\s*:\s*([^;"'}]+)/gi),
  ].map((match) => match[1].replace(/!important/i, "").trim())
  return /background-image\s*:/i.test(sanitizedHtml) || values.some((value) => !PLAIN_BACKGROUND.test(value))
}

/**
 * Plain mail in the dark theme: no paper, light text, links that read on dark.
 * The mail's own text colours were chosen for white, so they give way too.
 */
const DARK_STYLE = [
  ":root{color-scheme:dark}",
  "html,body{background:transparent!important;color:#e4e4e1!important}",
  "#evido-mail *{color:inherit!important;background-color:transparent!important;border-color:rgba(255,255,255,.14)!important}",
  "#evido-mail a,#evido-mail a *{color:#8fb3ff!important}",
  "#evido-mail hr{border-color:rgba(255,255,255,.14)!important}",
].join("")

export function buildEmailDocument(sanitizedHtml: string, allowImages: boolean, dark = false) {
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src data:${allowImages ? " https:" : ""}`,
    "font-src data:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ")
  const style = dark ? FRAME_STYLE + DARK_STYLE : FRAME_STYLE
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>${style}</style></head><body><div id="evido-mail">${sanitizedHtml}</div></body></html>`
}
