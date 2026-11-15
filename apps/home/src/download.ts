// The download page for the Even desktop apps (jornboerema.nl/download): per app a
// button for this computer's installer, the others below it, the newest version, and
// English or Dutch. The page brings its own texts and installers; elements with
// data-i18n="key" get the text for that key.

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

/** One app to download: where its installers are and how its releases are tagged. */
export type DownloadApp = {
  /** The release tags of this app start with this, e.g. "capture-v". */
  tagPrefix: string
  /** Where the installers live under stable names. */
  downloadUrl: (asset: string) => string
  assets: Record<Platform, string>
}

export type DownloadPage<T extends DownloadTexts> = DownloadApp & {
  texts: Record<Language, T>
  /**
   * More apps on the same page. Each fills the elements whose ids end in its
   * suffix: "capture" fills #primary-capture, #others-capture and #version-capture.
   */
  more?: Record<string, DownloadApp>
}

const STORAGE_KEY = "even.language"

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
  /** The page's own app has no suffix; the others carry theirs. */
  const apps: [suffix: string, app: DownloadApp][] = [["", page], ...Object.entries(page.more ?? {}).map(([name, app]) => [`-${name}`, app] as [string, DownloadApp])]
  const versions = new Map<DownloadApp, string>()

  const render = () => {
    const t = page.texts[language]
    document.documentElement.lang = language
    for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const value = t[element.dataset.i18n as keyof T]
      if (typeof value === "string") element.textContent = value
    }

    for (const [suffix, app] of apps) {
      // One button for this computer; the other installers as quiet links below.
      const primary = $<HTMLAnchorElement>(`primary${suffix}`)
      if (primary) {
        primary.href = app.downloadUrl(app.assets[platform])
        primary.querySelector(".label")!.textContent = t.download[platform]
        primary.querySelector(".file")!.textContent = t.file[platform]
      }
      const others = (Object.keys(app.assets) as Platform[]).filter((p) => p !== platform)
      $(`others${suffix}`)?.replaceChildren(
        ...others.flatMap((p, i) => {
          const link = Object.assign(document.createElement("a"), {
            href: app.downloadUrl(app.assets[p]),
            textContent: t.platform[p],
          })
          return i ? [document.createTextNode(" · "), link] : [link]
        })
      )
      const versionLine = $(`version${suffix}`)
      const version = versions.get(app)
      if (versionLine) versionLine.textContent = version ? t.version(version) : ""
    }

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

  // The newest version of each app, for the line under its downloads. The links work without it.
  fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`)
    .then((response) => (response.ok ? response.json() : []))
    .then((releases: { tag_name: string; draft: boolean; prerelease: boolean }[]) => {
      for (const [, app] of apps) {
        const release = releases.find((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(app.tagPrefix))
        if (release) versions.set(app, release.tag_name.slice(app.tagPrefix.length))
      }
      if (versions.size) render()
    })
    .catch(() => {})
}

export const releaseUrl = (tag: string) => (asset: string) => `https://github.com/${REPO}/releases/download/${tag}/${asset}`
export const latestReleaseUrl = (asset: string) => `https://github.com/${REPO}/releases/latest/download/${asset}`
