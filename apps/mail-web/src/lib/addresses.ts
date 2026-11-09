import type { MailAddress } from "@evido/mail-core/types"

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

export const isEmail = (value: string) => EMAIL.test(value)

/** Finished recipients, plus the one still being typed after the last separator. */
export function splitRecipients(value: string) {
  const parts = value.split(/[,;\s]+/)
  const draft = parts.pop() ?? ""
  return { entries: [...new Set(parts.filter(Boolean))], draft }
}

export function joinRecipients(entries: string[], draft = "") {
  return entries.length > 0 ? `${entries.join(", ")}, ${draft}` : draft
}

/** Pasted "Name <address>" pairs become bare addresses, so names can't split into recipients. */
export const stripDisplayNames = (value: string) => value.replace(/(?:"[^"]*"|[^,;<>"])*<([^<>\s]+)>/g, "$1,")

/** Reads a comma separated recipient field, naming the first entry that isn't an address. */
export function parseAddresses(value: string): { addresses: MailAddress[]; invalid: string | null } {
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const invalid = parts.find((part) => !EMAIL.test(part)) ?? null
  return { addresses: parts.map((email) => ({ name: null, email })), invalid }
}
