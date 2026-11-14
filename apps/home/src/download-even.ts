// jornboerema.nl/download: Even, the desktop app with Even mailen and Even doen,
// and Even vastleggen, the screenshot app.
import { latestReleaseUrl, releaseUrl, startDownloadPage, type DownloadTexts } from "./download"

const en = {
  download: { mac: "download for mac", "mac-intel": "download for mac (intel)", windows: "download for windows" },
  platform: { mac: "mac · apple silicon", "mac-intel": "mac · intel", windows: "windows" },
  file: { mac: "dmg ↓", "mac-intel": "dmg ↓", windows: "exe ↓" },
  version: (version: string) => `version ${version}`,
  switchTo: "Nederlands",
  intro: "Even mailen and Even doen in one desktop app.",
  introCapture: "Screenshots in a moment: capture, draw on it, copy or save.",
  alsoFor: "also for",
  source: "source",
} satisfies DownloadTexts & Record<string, unknown>

const nl: typeof en = {
  download: { mac: "download voor mac", "mac-intel": "download voor mac (intel)", windows: "download voor windows" },
  platform: en.platform,
  file: en.file,
  version: (version) => `versie ${version}`,
  switchTo: "English",
  intro: "Even mailen en Even doen in één desktop-app.",
  introCapture: "Screenshots in een moment: vastleggen, erop tekenen, kopiëren of bewaren.",
  alsoFor: "ook voor",
  source: "broncode",
}

startDownloadPage({
  tagPrefix: "even-v",
  // Even keeps its newest installers in a release of its own; "latest" belongs to Even vastleggen.
  downloadUrl: releaseUrl("even-updates"),
  assets: { mac: "Even-mac-apple-silicon.dmg", "mac-intel": "Even-mac-intel.dmg", windows: "Even-windows-setup.exe" },
  texts: { en, nl },
  more: {
    // Even vastleggen's releases are this repo's latest ones.
    capture: {
      tagPrefix: "capture-v",
      downloadUrl: latestReleaseUrl,
      assets: {
        mac: "Even-vastleggen-mac-apple-silicon.dmg",
        "mac-intel": "Even-vastleggen-mac-intel.dmg",
        windows: "Even-vastleggen-windows-setup.exe",
      },
    },
  },
})
