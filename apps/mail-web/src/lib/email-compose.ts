const STYLES: Record<string, string> = {
  P: "margin:0 0 1em",
  UL: "margin:0 0 1em;padding-left:1.5em",
  OL: "margin:0 0 1em;padding-left:1.5em",
  BLOCKQUOTE: "margin:0 0 1em;padding-left:12px;border-left:2px solid #d0d0d0;color:#555555",
  CODE: "font-family:monospace;background:#f2f2f2;padding:1px 4px;border-radius:3px",
}

/**
 * Editor output as mail clients need it: they ignore this app's stylesheet and
 * show `<p>` inside a list with gaps, so spacing has to live on the elements.
 */
export function toEmailHtml(html: string) {
  const template = document.createElement("template")
  template.innerHTML = html
  template.content.querySelectorAll("li > p").forEach((paragraph) => {
    paragraph.replaceWith(...paragraph.childNodes)
  })
  template.content.querySelectorAll("*").forEach((element) => {
    const style = STYLES[element.tagName]
    if (style) element.setAttribute("style", style)
    if (element.tagName === "P" && !element.hasChildNodes()) element.append(document.createElement("br"))
  })
  const container = document.createElement("div")
  container.setAttribute("style", "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5")
  container.append(template.content)
  return container.outerHTML
}
