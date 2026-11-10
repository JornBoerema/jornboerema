import { cn } from "@evido/ui/lib/utils"

/** A stable number for an address, so a person keeps their colour everywhere. */
function hueOf(email: string) {
  let hash = 0
  for (const char of email.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

/** "Jorn Boerema" → "JB", "jorn | Daize" → "JD", no name → the address's first letter. */
function initialsOf(name: string | null, email: string) {
  const words = (name ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1)] : words.length === 1 ? [words[0]] : [email]
  return letters.map((word) => word?.charAt(0) ?? "").join("").toUpperCase()
}

/**
 * Initials on a colour from the address. No pictures: those would need another
 * Google permission, or send contacts' addresses to a service like Gravatar.
 */
export function ContactAvatar({ name, email, className }: { name: string | null; email: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
        className
      )}
      style={{ background: `oklch(0.6 0.12 ${hueOf(email)})` }}
    >
      {initialsOf(name, email)}
    </span>
  )
}
