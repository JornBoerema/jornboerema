// capture.jornboerema.nl: download page for Even vastleggen. Its styles and
// script are shared with jornboerema.nl/download.
import "../../home/src/style.css"
import { latestReleaseUrl, startDownloadPage, type DownloadTexts } from "../../home/src/download"

const en = {
  download: { mac: "download for mac", "mac-intel": "download for mac (intel)", windows: "download for windows" },
  platform: { mac: "mac · apple silicon", "mac-intel": "mac · intel", windows: "windows" },
  file: { mac: "dmg ↓", "mac-intel": "dmg ↓", windows: "exe ↓" },
  version: (version: string) => `version ${version}`,
  switchTo: "Nederlands",
  intro: "Screenshots in a moment, for macOS and Windows.",
  alsoFor: "also for",
  source: "source",
} satisfies DownloadTexts & Record<string, unknown>

const nl: typeof en = {
  download: { mac: "download voor mac", "mac-intel": "download voor mac (intel)", windows: "download voor windows" },
  platform: en.platform,
  file: en.file,
  version: (version) => `versie ${version}`,
  switchTo: "English",
  intro: "Screenshots in een moment, voor macOS en Windows.",
  alsoFor: "ook voor",
  source: "broncode",
}

startDownloadPage({
  tagPrefix: "capture-v",
  // Even vastleggen's releases are this repo's latest ones.
  downloadUrl: latestReleaseUrl,
  assets: {
    mac: "Even-vastleggen-mac-apple-silicon.dmg",
    "mac-intel": "Even-vastleggen-mac-intel.dmg",
    windows: "Even-vastleggen-windows-setup.exe",
  },
  texts: { en, nl },
})
