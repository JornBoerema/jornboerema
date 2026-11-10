/** What a language model wrote for a message, as it streams in or once it's done. */
export type WrittenMessage = { subject: string | null; text: string }

const SUBJECT = "subject:"

/**
 * Splits model output into subject and body. Called again on every streamed
 * piece: while the first line might still turn out to be a subject line, the
 * body waits for it.
 */
export function parseWritten(content: string, { done = true } = {}): WrittenMessage {
  let text = content.replace(/\r\n/g, "\n").replace(/^\s+/, "")
  let subject: string | null = null
  const lead = text.slice(0, SUBJECT.length).toLowerCase()
  if (SUBJECT.startsWith(lead) && lead.length > 0) {
    const lineEnd = text.indexOf("\n")
    if (lineEnd === -1) {
      if (!done) return { subject: null, text: "" }
      if (lead === SUBJECT) return { subject: text.slice(SUBJECT.length).trim() || null, text: "" }
    } else if (lead === SUBJECT) {
      subject = text.slice(SUBJECT.length, lineEnd).trim() || null
      text = text.slice(lineEnd + 1)
    }
  }
  // Models like to fence or bold things; a mail body has neither.
  text = text
    .replace(/^\s*```[a-z]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
  return { subject, text: done ? text.trim() : text.replace(/^\s+/, "") }
}
