// Safe to import from browsers: no Node APIs here.
//
// "morgen 10 uur", "over 2 weken", "next friday 9am": a moment in plain words,
// in Dutch or English, read in the reader's own time zone. For snoozing and
// sending later, so always in the future.

/** A day without a time starts here: the start of a working day. */
const DEFAULT_HOUR = 8

const NUMBER_WORDS: Record<string, number> = {
  een: 1, één: 1, a: 1, an: 1, one: 1,
  twee: 2, two: 2, drie: 3, three: 3, vier: 4, four: 4, vijf: 5, five: 5,
  zes: 6, six: 6, zeven: 7, seven: 7, acht: 8, eight: 8, negen: 9, nine: 9,
  tien: 10, ten: 10, elf: 11, eleven: 11, twaalf: 12, twelve: 12,
}

const WEEKDAYS: Record<string, number> = {
  zondag: 0, zo: 0, sunday: 0, sun: 0,
  maandag: 1, ma: 1, monday: 1, mon: 1,
  dinsdag: 2, di: 2, tuesday: 2, tue: 2, tues: 2,
  woensdag: 3, wo: 3, wednesday: 3, wed: 3,
  donderdag: 4, do: 4, thursday: 4, thu: 4, thurs: 4,
  vrijdag: 5, vr: 5, friday: 5, fri: 5,
  zaterdag: 6, za: 6, saturday: 6, sat: 6,
}

const MONTHS: Record<string, number> = {
  januari: 0, jan: 0, january: 0,
  februari: 1, feb: 1, february: 1,
  maart: 2, mrt: 2, march: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4, may: 4,
  juni: 5, jun: 5, june: 5,
  juli: 6, jul: 6, july: 6,
  augustus: 7, aug: 7, august: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9, october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

const UNIT_MS = { minute: 60_000, hour: 3_600_000 } as const
type Unit = "minute" | "hour" | "day" | "week" | "month"

function unitOf(word: string): Unit | null {
  if (/^(m|min|mins|minuut|minuten|minute|minutes)$/.test(word)) return "minute"
  if (/^(u|h|uur|uren|hour|hours|hr|hrs)$/.test(word)) return "hour"
  if (/^(d|dag|dagen|day|days)$/.test(word)) return "day"
  if (/^(w|wk|week|weken|weeks)$/.test(word)) return "week"
  if (/^(maand|maanden|month|months|mnd)$/.test(word)) return "month"
  return null
}

const numberOf = (word: string) => (/^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? null))

const atDay = (base: Date, days: number) => {
  const day = new Date(base)
  day.setDate(day.getDate() + days)
  return day
}

/** The next given weekday after today (a week ahead when it is that day now). */
function nextWeekday(now: Date, weekday: number) {
  const ahead = (weekday - now.getDay() + 7) % 7 || 7
  return atDay(now, ahead)
}

type Time = { hour: number; minute: number }

/**
 * A clock time in the words: "10:30", "10 uur", "om 9", "half 3", "kwart over 4",
 * "9am", "15u". Bare hours before 7 mean the afternoon, as people say them.
 */
function timeIn(text: string): { time: Time; rest: string } | null {
  const take = (match: RegExpMatchArray, time: Time) => ({ time, rest: text.replace(match[0], " ") })
  const pm = (hour: number, suffix?: string) => {
    if (suffix === "pm" && hour < 12) return hour + 12
    if (suffix === "am" && hour === 12) return 0
    return hour
  }
  const dayPart = (hour: number) => {
    if (/'?s ?avonds|in the evening|tonight|vanavond/.test(text) && hour < 12) return hour + 12
    if (/'?s ?middags|in the afternoon|vanmiddag/.test(text) && hour < 12) return hour + 12
    return hour
  }
  // Without am/pm or a part of the day, 1 to 6 o'clock is in the afternoon.
  const guess = (hour: number, explicit: boolean) => (explicit ? hour : hour >= 1 && hour <= 6 ? hour + 12 : hour)
  const explicitPart = /'?s ?(avonds|middags|ochtends|morgens)|in the (morning|afternoon|evening)|tonight|vanavond|vanmiddag|vanochtend/.test(text)

  let match = text.match(/\bkwart (over|voor) (\d{1,2})\b/)
  if (match) {
    const hour = guess(dayPart(Number(match[2])), explicitPart)
    return take(match, match[1] === "over" ? { hour, minute: 15 } : { hour: hour - 1, minute: 45 })
  }
  match = text.match(/\bhalf (\d{1,2})\b/)
  if (match) return take(match, { hour: guess(dayPart(Number(match[1]) - 1), explicitPart), minute: 30 })
  match = text.match(/\b(?:om |at |@ ?)?(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/)
  if (match) {
    const hour = pm(dayPart(Number(match[1])), match[3])
    return take(match, { hour, minute: Number(match[2]) })
  }
  match = text.match(/\b(?:om |at |@ ?)?(\d{1,2})\s*(am|pm|uur|u|h|o'clock)\b/)
  if (match) {
    const explicit = match[2] === "am" || match[2] === "pm" || explicitPart
    return take(match, { hour: guess(pm(dayPart(Number(match[1])), match[2]), explicit), minute: 0 })
  }
  match = text.match(/\b(?:om|at) (\d{1,2})\b/)
  if (match) return take(match, { hour: guess(dayPart(Number(match[1])), explicitPart), minute: 0 })
  if (/\b(noon|middag|12 uur 's middags)\b/.test(text) && !/\bvanmiddag|morgenmiddag\b/.test(text))
    return { time: { hour: 12, minute: 0 }, rest: text.replace(/\b(noon|middag)\b/, " ") }
  return null
}

/** The day the words name, or null when they name none. */
function dayIn(text: string, now: Date): Date | null {
  if (/\bovermorgen\b|\bday after tomorrow\b/.test(text)) return atDay(now, 2)
  if (/\bmorgen|tomorrow\b/.test(text)) return atDay(now, 1)
  if (/\bvandaag|today|vanavond|vanmiddag|vanochtend|tonight\b/.test(text)) return atDay(now, 0)
  if (/\b(dit |this |het |the )?weekend\b/.test(text)) return now.getDay() === 6 ? atDay(now, 7) : nextWeekday(now, 6)
  if (/\b(volgende week|next week)\b/.test(text) && !/\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text))
    return nextWeekday(now, 1)

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (name.length <= 3 && !new RegExp(`\\b(volgende|next|op|on) ${name}\\b`).test(text) && !new RegExp(`^${name}\\b`).test(text.trim()))
      continue
    if (new RegExp(`\\b${name}\\b`).test(text)) {
      // "volgende week vrijdag": the Friday of next week, not the coming one.
      if (/\b(volgende week|next week)\b/.test(text)) return atDay(nextWeekday(now, 1), (weekday + 6) % 7)
      const day = nextWeekday(now, weekday)
      return day
    }
  }

  // "12 november", "12 nov 2027", "november 12", "12-11", "12/11/2027".
  let match = text.match(/\b(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?\b/)
  let day: number | null = null
  let month: number | null = null
  let year: number | null = null
  if (match && MONTHS[match[2]] !== undefined) {
    day = Number(match[1])
    month = MONTHS[match[2]]
    year = match[3] ? Number(match[3]) : null
  } else if ((match = text.match(/\b([a-z]+) (\d{1,2})(?:,? (\d{4}))?\b/)) && MONTHS[match[1]] !== undefined) {
    day = Number(match[2])
    month = MONTHS[match[1]]
    year = match[3] ? Number(match[3]) : null
  } else if ((match = text.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/))) {
    day = Number(match[1])
    month = Number(match[2]) - 1
    year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : null
  }
  if (day === null || month === null || month < 0 || month > 11 || day < 1 || day > 31) return null
  const date = new Date(year ?? now.getFullYear(), month, day)
  if (date.getMonth() !== month) return null
  // Without a year, a date already past this year means next year's.
  if (year === null && atDay(date, 1).getTime() <= now.getTime()) date.setFullYear(date.getFullYear() + 1)
  return date
}

/** Parts of the day without a clock time: "morgenavond", "this afternoon". */
function dayPartHour(text: string): number | null {
  if (/avond|evening|tonight/.test(text)) return 20
  if (/middag|afternoon/.test(text)) return 14
  if (/ochtend|morgens|morning/.test(text)) return 8
  return null
}

/**
 * The moment the words name, or null when they don't name one or name one
 * that has passed. A time alone that has passed today means tomorrow.
 */
export function parseWhen(input: string, now = new Date()): Date | null {
  const text = input
    .toLowerCase()
    .normalize("NFC")
    .replace(/[,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return null

  // "over 2 weken", "in 3 days", "2 uur", "30 min".
  const relative = text.match(/^(over |in |na |within )?(\S+) ([a-z]+)(?: (?:from now|later|vanaf nu))?$/)
  if (relative) {
    const amount = numberOf(relative[2])
    const unit = unitOf(relative[3])
    // "17 uur" is a time of day; only "over 17 uur" counts from now.
    const counts = relative[1] !== undefined || (unit !== "hour" && unit !== null)
    if (amount !== null && unit && amount > 0 && counts) {
      if (unit === "minute" || unit === "hour") return new Date(now.getTime() + amount * UNIT_MS[unit])
      const date = new Date(now)
      if (unit === "day") date.setDate(date.getDate() + amount)
      if (unit === "week") date.setDate(date.getDate() + amount * 7)
      if (unit === "month") date.setMonth(date.getMonth() + amount)
      date.setHours(DEFAULT_HOUR, 0, 0, 0)
      return date
    }
  }
  // "over een uur", "in an hour" with the article spelled out, and "over een week".
  const article = text.match(/^(?:over|in) (?:een|één|an|a) ([a-z]+)$/)
  if (article && unitOf(article[1])) return parseWhen(`over 1 ${article[1]}`, now)

  const found = timeIn(text)
  const day = dayIn(found?.rest ?? text, now)
  if (!found && !day) return null

  const hour = found?.time.hour ?? dayPartHour(text) ?? DEFAULT_HOUR
  const minute = found?.time.minute ?? 0
  if (hour < 0 || hour > 23 || minute > 59) return null
  const date = new Date(day ?? now)
  date.setHours(hour, minute, 0, 0)
  if (date.getTime() <= now.getTime()) {
    // A time alone that has passed today is meant for tomorrow; a named day that has passed isn't valid.
    if (day) return null
    date.setDate(date.getDate() + 1)
  }
  return date
}
