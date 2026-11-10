// Safe to import from browsers: no Node APIs here.

/**
 * Words that announce a one-time code, in the languages mail here arrives in.
 * Only words about a code itself: "security" or "login" alone also appear in
 * alerts and footers, where numbers are addresses or order numbers.
 */
const NEAR = new RegExp(
  "\\b(" +
    [
      "codes?",
      "otp",
      "passcode",
      "pin",
      "2fa",
      "one[- ]time",
      "eenmalige?",
      "verificat\\w*",
      "verification",
      "\\w*code",
      "bestätigungs\\w*",
    ].join("|") +
    ")\\b",
  "i"
)

/** Four to eight digits, maybe split in two by a space or dash, or six to eight capitals and digits. */
const CANDIDATE = /(?<![\w€$£.,:/-])(\d{3,4}[- ]\d{3,4}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w%€$£/-]|[.,]\d|:\d)/g

/** How far a code may sit from its word: a short sentence. */
const REACH = 40
/** A code mail says so near the start; a mention deep in a footer doesn't count. */
const OPENING = 600

const looksLikeYear = (value: string) => /^(19|20)\d\d$/.test(value)

/**
 * A one-time sign-in or verification code in a message, or null. Only codes near a
 * word that announces one count, so order numbers and dates don't.
 */
export function findOneTimeCode(subject: string, text: string): string | null {
  const content = `${subject}\n${text}`.slice(0, 20_000)
  if (!NEAR.test(content.slice(0, subject.length + OPENING))) return null
  for (const match of content.matchAll(CANDIDATE)) {
    const value = match[0]
    if (looksLikeYear(value)) continue
    const start = match.index ?? 0
    const around = content.slice(Math.max(0, start - REACH), start + value.length + REACH)
    if (NEAR.test(around)) return value
  }
  return null
}
