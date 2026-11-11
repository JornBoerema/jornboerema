// Safe to import from browsers: no Node APIs here.
//
// The List-Unsubscribe header (RFC 2369) and its one-click form (RFC 8058),
// which mailing lists send so mail apps can offer an Unsubscribe button.

export type MailUnsubscribe = {
  /** An https link: posted to when `oneClick`, else opened for the reader. */
  url: string | null
  /** A mailbox that unsubscribes whoever writes to it. */
  mailto: { address: string; subject: string; body: string } | null
  /** List-Unsubscribe-Post says one POST to `url` does it, no page to visit. */
  oneClick: boolean
}

function parseMailto(value: string): MailUnsubscribe["mailto"] {
  try {
    const url = new URL(value)
    const address = decodeURIComponent(url.pathname).trim()
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) return null
    return {
      address,
      subject: url.searchParams.get("subject") ?? "unsubscribe",
      body: url.searchParams.get("body") ?? "unsubscribe",
    }
  } catch {
    return null
  }
}

/** What a message's List-Unsubscribe headers offer, or null when they offer nothing usable. */
export function parseListUnsubscribe(header: string | null | undefined, post?: string | null): MailUnsubscribe | null {
  if (!header) return null
  let url: string | null = null
  let mailto: MailUnsubscribe["mailto"] = null
  // "<https://…>, <mailto:…>": each choice between angle brackets.
  for (const [, value] of header.matchAll(/<\s*([^>]+?)\s*>/g)) {
    if (!url && /^https:\/\//i.test(value)) url = value
    else if (!mailto && /^mailto:/i.test(value)) mailto = parseMailto(value)
  }
  if (!url && !mailto) return null
  const oneClick = Boolean(url) && /List-Unsubscribe\s*=\s*One-Click/i.test(post ?? "")
  return { url, mailto, oneClick }
}
