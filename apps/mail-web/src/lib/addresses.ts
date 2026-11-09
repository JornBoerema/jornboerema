import type { MailAddress } from "@evido/mail-core/types"

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

/** Reads a comma separated recipient field, naming the first entry that isn't an address. */
export function parseAddresses(value: string): { addresses: MailAddress[]; invalid: string | null } {
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const invalid = parts.find((part) => !EMAIL.test(part)) ?? null
  return { addresses: parts.map((email) => ({ name: null, email })), invalid }
}
