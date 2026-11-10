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
 * Wraps sanitized mail in a document for a sandboxed iframe. The policy is a
 * second line of defence: it still blocks scripts and remote loading if a
 * sanitizer bug ever lets something through.
 */
/**
 * The frame grows to its content and never scrolls itself, so scrolling always
 * moves the conversation. Mail often sets html and body to 100% high, which
 * would pin them to the frame; important keeps them sized by their content.
 * Mail wider than the pane scrolls sideways inside its own wrapper.
 */
const FRAME_STYLE = [
  "html,body{margin:0;background:#fff;color:#111;height:auto!important;min-height:0!important;overflow:hidden!important}",
  "body{padding:12px;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}",
  "#evido-mail{overflow-x:auto;overflow-y:hidden}",
  "img{max-width:100%;height:auto}",
].join("")

export function buildEmailDocument(sanitizedHtml: string, allowImages: boolean) {
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src data:${allowImages ? " https:" : ""}`,
    "font-src data:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ")
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>${FRAME_STYLE}</style></head><body><div id="evido-mail">${sanitizedHtml}</div></body></html>`
}
