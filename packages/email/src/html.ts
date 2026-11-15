/**
 * The HTML part of every Even e-mail, made from its plain text: paragraphs at
 * blank lines, and a line that is only a link becomes a button (with `button`
 * as its label) followed by the link in small print for clients that block it.
 * A mail with both parts, a real button and no bare token in the body reads as
 * a normal transactional mail to spam filters, not as a link drop.
 */
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const URL_LINE = /^https?:\/\/\S+$/

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const ORANGE = "#e8692c"

function paragraph(lines: string[]) {
  return `<p style="margin:0 0 16px;font:15px/1.6 ${FONT};color:#2b2622">${lines.map(escape).join("<br>")}</p>`
}

function button(url: string, label: string) {
  const href = escape(url)
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:${ORANGE}">`,
    `<a href="${href}" style="display:inline-block;padding:12px 22px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px">${escape(label)}</a>`,
    `</td></tr></table>`,
  ].join("")
}

function smallLink(url: string, hint: string) {
  const href = escape(url)
  return `<p style="margin:0 0 16px;font:12px/1.5 ${FONT};color:#8a817a">${escape(hint)}<br><a href="${href}" style="color:#8a817a;word-break:break-all">${href}</a></p>`
}

export function emailHtml({ text, button: label, language }: { text: string; button?: string; language?: "en" | "nl" }) {
  const nl = language === "nl" || (!language && /\b(je|jouw|het|een|niet)\b/i.test(text))
  const hint = nl ? "Werkt de knop niet? Open deze link:" : "Button not working? Open this link:"
  const blocks: string[] = []
  let lines: string[] = []
  const flush = () => {
    if (lines.length) blocks.push(paragraph(lines))
    lines = []
  }
  const links: string[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (label && URL_LINE.test(line)) {
      flush()
      blocks.push(button(line, label))
      links.push(line)
      continue
    }
    lines.push(raw)
  }
  flush()
  // The plain link once, at the end, so the button stays the thing to click.
  const fallback = [...new Set(links)].map((url) => smallLink(url, hint)).join("")

  return `<!doctype html>
<html lang="${nl ? "nl" : "en"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f6f3ef">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ef"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px;font:700 20px/1 ${FONT};color:#1c1916;letter-spacing:-0.4px">Even<span style="color:${ORANGE}">.</span></td></tr>
<tr><td style="background:#ffffff;border-radius:12px;padding:32px 32px 16px">${blocks.join("")}${fallback}</td></tr>
<tr><td style="padding:20px 4px 0;font:12px/1.5 ${FONT};color:#8a817a">Even · <a href="https://jornboerema.nl" style="color:#8a817a">jornboerema.nl</a></td></tr>
</table>
</td></tr></table>
</body>
</html>`
}
