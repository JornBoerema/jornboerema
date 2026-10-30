export type Language = "en" | "nl"
export const LANGUAGES: Language[] = ["en", "nl"]
export const DEFAULT_LANGUAGE: Language = "en"

/** BCP 47 locale for Intl date/number formatting. */
export const LOCALES: Record<Language, string> = { en: "en-GB", nl: "nl-NL" }

export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", nl: "Nederlands" }

export const isLanguage = (value: unknown): value is Language =>
  value === "en" || value === "nl"

/**
 * Picks the best supported language from an Accept-Language header
 * (e.g. "nl-NL,nl;q=0.9,en;q=0.8"). Used by the API for errors and e-mails.
 */
export function pickLanguage(header: string | null | undefined): Language {
  if (!header) return DEFAULT_LANGUAGE
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";")
      const q = params.find((p) => p.trim().startsWith("q="))
      return { tag: tag.toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1 }
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    const base = tag.split("-")[0]
    if (isLanguage(base)) return base
  }
  return DEFAULT_LANGUAGE
}

/**
 * A dictionary is a nested object of strings and small formatting functions
 * (for plurals and interpolation). Other languages are typed against the
 * English one, so a missing or misspelled key is a type error.
 */
export type Messages = { readonly [key: string]: string | ((...args: never[]) => string) | Messages }
