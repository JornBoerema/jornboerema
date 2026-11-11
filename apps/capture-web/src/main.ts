// Download page for Even vastleggen: picks the right installer for this
// computer, shows the latest version and switches between English and Dutch.

const RELEASES = "https://github.com/JornBoerema/jornboerema/releases"
const download = (asset: string) => `${RELEASES}/latest/download/${asset}`

type Platform = "mac" | "mac-intel" | "windows"

const ASSETS: Record<Platform, string> = {
  mac: "Even-vastleggen-mac-apple-silicon.dmg",
  "mac-intel": "Even-vastleggen-mac-intel.dmg",
  windows: "Even-vastleggen-windows-setup.exe",
}

const en = {
  eyebrow: "screenshots",
  intro: "Screenshots in a moment. Capture your screen, an area or a window, draw on it, and copy or save it.",
  download: { mac: "Download for Mac", "mac-intel": "Download for Mac (Intel)", windows: "Download for Windows" },
  platform: { mac: "Mac (Apple Silicon)", "mac-intel": "Mac (Intel)", windows: "Windows" },
  meta: (version: string, platform: string) => `Version ${version} · ${platform}`,
  macHint: "Apple Silicon (M1 or newer)",
  alsoFor: "Also for",
  shortcuts: "Shortcuts",
  screen: "Capture the screen under the mouse",
  area: "Select an area on a frozen screen",
  window: "Click a window to capture it",
  shortcutsNote: "You can change them in the settings.",
  then: "Then",
  draw: "draw",
  drawText: "Arrows, boxes, circles, lines, pen, highlighter, text, numbered steps and blur.",
  share: "share",
  shareText: "Copy or save at full resolution, or skip the editor and copy or save right away.",
  stay: "stays",
  stayText: "In the menu bar or system tray, out of your way. It updates itself.",
  firstLaunch: "First launch",
  unsigned: "The Mac app is signed and checked by Apple. On Windows the app isn't signed yet, so Windows asks once whether you trust it.",
  mac1: "Open the downloaded file and drag Even vastleggen to Applications.",
  mac2: "Open it, allow Screen Recording when asked, then open the app again.",
  win1: "Open the downloaded installer.",
  win2: "If Windows protected your PC: click More info, then Run anyway.",
  source: "Source",
  switchTo: "Nederlands",
}

type Messages = typeof en

const nl: Messages = {
  eyebrow: "screenshots",
  intro: "Screenshots in een moment. Leg je scherm, een gebied of een venster vast, teken erop en kopieer of bewaar het.",
  download: { mac: "Download voor Mac", "mac-intel": "Download voor Mac (Intel)", windows: "Download voor Windows" },
  platform: { mac: "Mac (Apple Silicon)", "mac-intel": "Mac (Intel)", windows: "Windows" },
  meta: (version, platform) => `Versie ${version} · ${platform}`,
  macHint: "Apple Silicon (M1 of nieuwer)",
  alsoFor: "Ook voor",
  shortcuts: "Sneltoetsen",
  screen: "Het scherm onder de muis vastleggen",
  area: "Een gebied kiezen op een stilstaand scherm",
  window: "Klik op een venster om het vast te leggen",
  shortcutsNote: "Je kunt ze aanpassen in de instellingen.",
  then: "Daarna",
  draw: "tekenen",
  drawText: "Pijlen, kaders, cirkels, lijnen, pen, markeerstift, tekst, genummerde stappen en vervagen.",
  share: "delen",
  shareText: "Kopieer of bewaar op volle resolutie, of sla de editor over en kopieer of bewaar meteen.",
  stay: "blijft",
  stayText: "In de menubalk of het systeemvak, uit de weg. Werkt zichzelf bij.",
  firstLaunch: "Eerste keer openen",
  unsigned: "De Mac-app is ondertekend en gecontroleerd door Apple. Op Windows is de app nog niet ondertekend, dus Windows vraagt één keer of je hem vertrouwt.",
  mac1: "Open het gedownloade bestand en sleep Even vastleggen naar Apps.",
  mac2: "Open de app, sta Schermopname toe als daarom gevraagd wordt en open de app opnieuw.",
  win1: "Open het gedownloade installatieprogramma.",
  win2: "Zegt Windows dat je pc beschermd is: klik op Meer info en dan op Toch uitvoeren.",
  source: "Broncode",
  switchTo: "English",
}

const STORAGE_KEY = "evido.language"
type Language = "en" | "nl"

function initialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "en" || stored === "nl") return stored
  return navigator.languages.some((tag) => tag.toLowerCase().startsWith("nl")) ? "nl" : "en"
}

const platform: Platform = /Win/i.test(navigator.userAgent) ? "windows" : "mac"
const isWindows = platform === "windows"
let language = initialLanguage()
let version: string | null = null

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function render() {
  const t = language === "nl" ? nl : en
  document.documentElement.lang = language
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const value = t[element.dataset.i18n as keyof Messages]
    if (typeof value === "string") element.textContent = value
  }

  const primary = $<HTMLAnchorElement>("primary")
  primary.href = download(ASSETS[platform])
  $("primary-label").textContent = t.download[platform]
  const target = isWindows ? t.platform.windows : t.macHint
  $("meta").textContent = version ? t.meta(version, target) : target

  const others = (Object.keys(ASSETS) as Platform[]).filter((p) => p !== platform)
  $("others").replaceChildren(
    ...others.flatMap((p, i) => {
      const link = Object.assign(document.createElement("a"), { href: download(ASSETS[p]), textContent: t.platform[p] })
      return i ? [document.createTextNode(" · "), link] : [link]
    })
  )

  // Shortcuts as this computer shows them.
  for (const key of document.querySelectorAll<HTMLElement>("kbd[data-key]")) {
    key.textContent = isWindows ? `Ctrl+Shift+${key.dataset.key}` : `⌥⇧${key.dataset.key}`
  }
  const toggle = $<HTMLButtonElement>("language")
  toggle.textContent = language === "nl" ? "EN" : "NL"
  toggle.setAttribute("aria-label", t.switchTo)
}

$("language").addEventListener("click", () => {
  language = language === "nl" ? "en" : "nl"
  localStorage.setItem(STORAGE_KEY, language)
  render()
})

// This computer's install steps first.
if (isWindows) $("steps-mac").before($("steps-windows"))

render()

// The newest version, for the line under the button. The download links work without it.
fetch("https://api.github.com/repos/JornBoerema/jornboerema/releases/latest")
  .then((response) => (response.ok ? response.json() : null))
  .then((release: { tag_name?: string } | null) => {
    const tag = release?.tag_name
    if (tag?.startsWith("capture-v")) {
      version = tag.slice("capture-v".length)
      render()
    }
  })
  .catch(() => {})
