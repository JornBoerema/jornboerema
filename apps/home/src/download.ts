// Download pages for the Even desktop apps (jornboerema.nl/download and
// capture.jornboerema.nl): a button for this computer's installer, the others
// below it, the newest version, and English or Dutch. Each page brings its own texts
// and installers; elements with data-i18n="key" get the text for that key.

const REPO = "JornBoerema/jornboerema"

export type Platform = "mac" | "mac-intel" | "windows"
export type Language = "en" | "nl"

/** What every download page words itself; pages add their own keys next to these. */
export type DownloadTexts = {
  /** The button for this computer, e.g. "download for mac". */
  download: Record<Platform, string>
  /** The other installers, e.g. "mac · intel". */
  platform: Record<Platform, string>
  /** The file each platform gets, e.g. "dmg". */
  file: Record<Platform, string>
  version: (version: string) => string
  switchTo: string
}

export type DownloadPage<T extends DownloadTexts> = {
  /** The release tags of this app start with this, e.g. "capture-v". */
  tagPrefix: string
  /** Where the installers live under stable names. */
  downloadUrl: (asset: string) => string
  assets: Record<Platform, string>
  texts: Record<Language, T>
}

const STORAGE_KEY = "evido.language"

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "nl") return stored
  } catch {
    // No storage: follow the browser.
  }
  return navigator.languages.some((tag) => tag.toLowerCase().startsWith("nl")) ? "nl" : "en"
}

export const platform: Platform = /Win/i.test(navigator.userAgent) ? "windows" : "mac"
export const isWindows = platform === "windows"

const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E | null

export function startDownloadPage<T extends DownloadTexts>(page: DownloadPage<T>, onRender?: (texts: T) => void) {
  let language = initialLanguage()
  let version: string | null = null

  const render = () => {
    const t = page.texts[language]
    document.documentElement.lang = language
    for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const value = t[element.dataset.i18n as keyof T]
      if (typeof value === "string") element.textContent = value
    }

    // One button for this computer; the other installers as quiet links below.
    const primary = $<HTMLAnchorElement>("primary")
    if (primary) {
      primary.href = page.downloadUrl(page.assets[platform])
      primary.querySelector(".label")!.textContent = t.download[platform]
      primary.querySelector(".file")!.textContent = t.file[platform]
    }
    const others = (Object.keys(page.assets) as Platform[]).filter((p) => p !== platform)
    $("others")?.replaceChildren(
      ...others.flatMap((p, i) => {
        const link = Object.assign(document.createElement("a"), {
          href: page.downloadUrl(page.assets[p]),
          textContent: t.platform[p],
        })
        return i ? [document.createTextNode(" · "), link] : [link]
      })
    )
    const versionLine = $("version")
    if (versionLine) versionLine.textContent = version ? t.version(version) : ""

    const toggle = $<HTMLButtonElement>("language")
    if (toggle) {
      toggle.textContent = language === "nl" ? "en" : "nl"
      toggle.setAttribute("aria-label", t.switchTo)
    }
    onRender?.(t)
  }

  $("language")?.addEventListener("click", () => {
    language = language === "nl" ? "en" : "nl"
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Only for this visit then.
    }
    render()
  })

  render()

  // The newest version of this app, for the line under the downloads. The links work without it.
  fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`)
    .then((response) => (response.ok ? response.json() : []))
    .then((releases: { tag_name: string; draft: boolean; prerelease: boolean }[]) => {
      const release = releases.find((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(page.tagPrefix))
      if (release) {
        version = release.tag_name.slice(page.tagPrefix.length)
        render()
      }
    })
    .catch(() => {})
}

export const releaseUrl = (tag: string) => (asset: string) => `https://github.com/${REPO}/releases/download/${tag}/${asset}`
export const latestReleaseUrl = (asset: string) => `https://github.com/${REPO}/releases/latest/download/${asset}`
