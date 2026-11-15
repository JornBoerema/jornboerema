// The home page: the words in English, the example inbox you can file with the
// app's own keys, the tab that marks where you are, and sheets that drop in.
// The page is written in Dutch in index.html; this holds the English beside it.

type Language = "en" | "nl"

const STORAGE_KEY = "evido.language"

const english: Record<string, string> = {
  skip: "Skip to the content",
  tabMail: "Mail",
  tabKeys: "Keys",
  tabPrivate: "Private",
  tabIncluded: "Extra",
  tabPrice: "Price",
  tabQuestions: "FAQ",
  tabStart: "Start",
  signIn: "Sign in",
  openApp: "Open the app",
  heroTitle: "Just do your mail.",
  heroLead:
    "Even mailen is the fast mail app for Outlook. Everything from the keyboard, with AI that summarises and helps you write. Made in the Netherlands.",
  trial: "Try it free for 14 days",
  heroPrice: "Then € 25 a month, incl. VAT",
  demoTag: "example",
  t1: "09:12",
  t2: "08:47",
  t3: "08:30",
  t4: "yesterday",
  t5: "yesterday",
  t6: "Mon",
  s4: "Parcel service",
  s5: "Business Newsletter",
  m1: "Website quote, please reply before Friday",
  m2: "Re: planning week 47",
  m3: "Invoice 2026-0412 for the business cards",
  m4: "Your parcel arrives tomorrow between 11 and 1",
  m5: "Ten tips for the fourth quarter",
  m6: "Coffee next week?",
  demoEmpty: "Empty.",
  demoEmptyLine: "Six mails, six keys.",
  demoAgain: "Once more",
  actArchive: "Archive",
  actSnooze: "Snooze",
  actTask: "Task",
  demoHint: "Press E, or click.",
  keysTitle: "Every action is one key.",
  k1: "Archive",
  k2: "Reply, with a suggestion already waiting",
  k3: "Snooze until it suits you",
  k4: "Make a task in Even doen",
  k5: "New message",
  k6: "Search all your mailboxes at once",
  k7: "Let AI write it",
  k8: "Every key in one list",
  moreTitle: "And without a key",
  x1: "A summary above every long conversation",
  x2: "Send later, at the hour you choose",
  x3: "Translate what you can't read",
  x4: "Unsubscribe from newsletters in one click",
  x5: "Track parcels from the confirmation mail",
  x6: "Invoices from your mail, on to Moneybird",
  x7: "Several mailboxes in one inbox",
  x8: 'In the browser, and as an <a href="/download">app for Mac and Windows</a>',
  privateTitle: "Your mail stays yours.",
  p1: "Your mailbox stays with Microsoft. Even mailen works on top of it, and Outlook keeps working as it did.",
  p2: "No AI model is trained on your mail. Nothing is sold, nothing is used for advertising.",
  p3: "Behind it is a Dutch sole proprietorship. You get an invoice with VAT and an answer from a person.",
  privateLink: "Read exactly what happens to your data",
  includedTitle: "The rest comes with it.",
  includedLead: "Tasks and notes are free, with or without a subscription. Agenda and chat join Even Pro as soon as they are done.",
  free: "free",
  soon: "soon",
  priceTitle: "One subscription. Even Pro.",
  priceLead: "Fourteen days free. You pay nothing until the trial ends, and you can cancel at any time.",
  gmailNote: "Outlook and Microsoft 365 work right away. Gmail is by invitation for now, until Google has finished its review.",
  periodLabel: "Billing period",
  monthly: "Monthly",
  yearly: "Yearly",
  perMonth: "a month",
  billedMonthly: "Paid every month.",
  billedYearly: "€ 240 once a year.",
  exVat: "Including VAT.",
  i1: "Even mailen, with all your mailboxes",
  i2: "Summaries, replies and writing with AI",
  i3: "Even doen and Even noteren",
  i4: "Agenda and chat, once they are here",
  questionsTitle: "Just this, then.",
  q1: "Does it work with my work Outlook?",
  a1: "Yes, with Microsoft 365 and with Outlook.com. At some companies the administrator has to give permission once; the app shows the way.",
  q2: "Do I have to move to another mail address?",
  a2: "No. You keep your address and your mailbox. Even mailen shows the same mail, only faster, and what you do here shows up in Outlook too.",
  q3: "What does the AI do with my mail?",
  a3: "Summarise, suggest replies and help you write when you ask for it. The providers keep nothing and train on nothing. You can also turn it off.",
  q4: "How do I cancel?",
  a4: "In your account, whenever you like. You keep access until the end of the period you paid for.",
  q5: "And Gmail?",
  a5: "Gmail works, but by invitation only for now. Google reviews every app that may read mail, and that review is still running.",
  q6: "Who is behind this?",
  a6: 'Jorn Boerema, a sole proprietorship from Oosterwolde, the Netherlands. Mail <a href="mailto:support@jornboerema.nl">support@jornboerema.nl</a> and the person who builds it answers.',
  coverLine: "Dutch for “just a moment”. That is how long it should take.",
  legalIds: "Chamber of Commerce 42064465 · VAT NL005468091B10",
  terms: "Terms",
}

/** What the example inbox says after each key, and the page's own labels. */
const words = {
  nl: {
    title: "Even. De snelle mailapp voor Outlook",
    tabsLabel: "Secties",
    switchTo: "Switch to English",
    archive: "Gearchiveerd.",
    snooze: "Gesnoozed tot morgen 9:00.",
    task: "Taak gemaakt in Even doen.",
    hint: "Druk op E, of klik.",
    hintTouch: "Tik op een mail, of op een toets.",
  },
  en: {
    title: "Even. The fast mail app for Outlook",
    tabsLabel: "Sections",
    switchTo: "Naar Nederlands",
    archive: "Archived.",
    snooze: "Snoozed until tomorrow 9:00.",
    task: "Task made in Even doen.",
    hint: "Press E, or click.",
    hintTouch: "Tap a mail, or a key.",
  },
} satisfies Record<Language, Record<string, string>>

const root = document.documentElement
const all = <E extends HTMLElement>(selector: string) => [...document.querySelectorAll<E>(selector)]

// Language

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "nl") return stored
  } catch {
    // No storage: follow the browser.
  }
  return navigator.languages.some((tag) => tag.toLowerCase().startsWith("nl")) ? "nl" : "en"
}

let language = initialLanguage()
/** The Dutch each element came with, kept so the page can switch back. */
const dutch = new Map<HTMLElement, string>()

function translate() {
  for (const element of all("[data-i18n]")) {
    if (!dutch.has(element)) dutch.set(element, element.innerHTML)
    const key = element.dataset.i18n as string
    element.innerHTML = language === "en" ? (english[key] ?? dutch.get(element)!) : dutch.get(element)!
  }
  const t = words[language]
  root.lang = language
  document.title = t.title
  document.querySelector(".tabs")?.setAttribute("aria-label", t.tabsLabel)
  for (const button of all("[data-language]")) {
    button.textContent = language === "nl" ? "EN" : "NL"
    button.setAttribute("aria-label", t.switchTo)
  }
  root.classList.remove("i18n-wait")
}

// Signed in already: the header leads into the app instead of to signing in.

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

async function markSignedIn() {
  try {
    const response = await fetch(`${API_URL}/api/auth/get-session`, { credentials: "include", cache: "no-store" })
    const session = (await response.json().catch(() => null)) as { user?: unknown } | null
    if (!response.ok || !session?.user) return
  } catch {
    return // No API, or not allowed from here: keep "Inloggen".
  }
  for (const link of all<HTMLAnchorElement>("[data-account]")) {
    link.dataset.i18n = "openApp"
    dutch.set(link, "Naar de app")
  }
  translate()
}

void markSignedIn()

for (const button of all("[data-language]")) {
  button.addEventListener("click", () => {
    language = language === "nl" ? "en" : "nl"
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Only for this visit then.
    }
    translate()
    say(hint())
  })
}

// The example inbox

type Act = "archive" | "snooze" | "task"
const KEYS: Record<string, Act> = { e: "archive", b: "snooze", t: "task" }

const demo = document.getElementById("demo")
const list = document.getElementById("demo-mails")
const count = document.getElementById("demo-count")
const empty = document.getElementById("demo-empty")
const keys = document.getElementById("demo-keys")
const status = document.getElementById("demo-status")
/** The six mails as the page came with them, to lay them out again. */
const original = list ? [...list.children].map((mail) => mail.cloneNode(true) as HTMLElement) : []
let demoInView = false

const waiting = () => all<HTMLLIElement>("#demo-mails .mail:not(.is-leaving)")

/** Phones have no E key to press. */
const hint = () => (matchMedia("(hover: none)").matches ? words[language].hintTouch : words[language].hint)

function say(text: string) {
  if (status) status.textContent = text
}

function mark(mail: HTMLElement | undefined) {
  for (const other of all("#demo-mails .mail")) other.classList.toggle("is-current", other === mail)
}

function step(by: number) {
  const mails = waiting()
  const at = mails.findIndex((mail) => mail.classList.contains("is-current"))
  mark(mails[Math.min(mails.length - 1, Math.max(0, at + by))])
}

function file(act: Act) {
  const mails = waiting()
  const mail = mails.find((item) => item.classList.contains("is-current")) ?? mails[0]
  if (!mail) return
  const next = mails[mails.indexOf(mail) + 1] ?? mails[mails.indexOf(mail) - 1]

  // Paper keeps its size: the sheet stays as tall as it was with all its mail on it.
  if (demo && !demo.style.minHeight) demo.style.minHeight = `${demo.offsetHeight}px`

  // Archive and task slide off towards the tabs; a snoozed mail drops out of sight.
  mail.classList.add("is-leaving")
  if (act === "snooze") mail.classList.add("is-down")
  else {
    const mailTab = tabs[0]
    mailTab?.classList.add("is-receiving")
    setTimeout(() => mailTab?.classList.remove("is-receiving"), 420)
  }
  mark(next)
  say(words[language][act])
  if (count) count.textContent = String(mails.length - 1)

  const button = keys?.querySelector(`[data-act="${act}"]`)
  button?.classList.add("is-pressed")
  setTimeout(() => button?.classList.remove("is-pressed"), 160)

  setTimeout(() => mail.classList.add("is-gone"), 240)
  setTimeout(() => {
    mail.remove()
    if (!list?.children.length) {
      list?.setAttribute("hidden", "")
      keys?.setAttribute("hidden", "")
      empty?.removeAttribute("hidden")
    }
  }, 600)
}

function again() {
  if (!list) return
  list.replaceChildren(...original.map((mail) => mail.cloneNode(true)))
  list.removeAttribute("hidden")
  keys?.removeAttribute("hidden")
  empty?.setAttribute("hidden", "")
  if (count) count.textContent = String(original.length)
  translate()
  mark(waiting()[0])
  say(hint())
  if (demo) demo.style.minHeight = ""
}

list?.addEventListener("click", (event) => {
  const mail = (event.target as HTMLElement).closest<HTMLElement>(".mail")
  if (!mail || mail.classList.contains("is-leaving")) return
  mark(mail)
  file("archive")
})

keys?.addEventListener("click", (event) => {
  const act = (event.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act as Act | undefined
  if (act) file(act)
})

document.getElementById("demo-again")?.addEventListener("click", again)

// The app's own keys work on the example while it is on screen.
document.addEventListener("keydown", (event) => {
  if (!demoInView || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement
  if (target.closest("input, textarea, select, [contenteditable]")) return
  const key = event.key.toLowerCase()
  if (key === "j") step(1)
  else if (key === "k") step(-1)
  else if (KEYS[key]) file(KEYS[key])
})

if (demo) new IntersectionObserver(([entry]) => (demoInView = entry.isIntersecting), { threshold: 0.3 }).observe(demo)

// The tab of the sheet you are on sticks out.
const tabs = all<HTMLAnchorElement>(".tab")
const sections = tabs.map((tab) => document.querySelector<HTMLElement>(tab.hash)).filter((section) => section !== null)

function markTab() {
  const line = window.innerHeight * 0.4
  const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
  const current = atEnd
    ? sections.at(-1)
    : (sections.findLast((section) => section.getBoundingClientRect().top <= line) ?? sections[0])
  for (const tab of tabs) {
    if (tab.hash === `#${current?.id}`) tab.setAttribute("aria-current", "true")
    else tab.removeAttribute("aria-current")
  }
}

window.addEventListener("scroll", markTab, { passive: true })
window.addEventListener("resize", markTab)

// Sheets drop in the first time they come into view, one after the other within a row.
const dropper = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add("is-in")
      dropper.unobserve(entry.target)
    }
  },
  { threshold: 0.15 }
)
for (const sheet of all(".drop")) {
  const siblings = [...(sheet.closest("ul")?.querySelectorAll(".drop") ?? [sheet])]
  sheet.style.setProperty("--i", String(siblings.indexOf(sheet)))
  dropper.observe(sheet)
}

translate()
say(hint())
mark(waiting()[0])
markTab()
