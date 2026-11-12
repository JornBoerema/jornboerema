import { useEffect, useMemo, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useCurrentLanguage } from "@evido/i18n/react"
import type { DesktopApp, DesktopTexts } from "@evido/ui/components/desktop-app"

const TEXTS: Record<"en" | "nl", DesktopTexts> = {
  en: {
    about: "About",
    app: "App",
    version: "Version",
    versionHelp: "The version of Even on this computer.",
    ready: (version) => `Version ${version} is downloaded and installs when Even restarts.`,
    checkFailed: "Couldn't check for updates. Try again in a moment.",
    check: "Check for updates",
    checking: "Checking…",
    upToDate: "Up to date",
    restart: "Restart to update",
    restarting: "Restarting…",
    download: "Download page",
    downloadHelp: "Even for your other computers, on Mac and Windows.",
    open: "Open",
    legal: "Legal",
    privacy: "Privacy policy",
    privacyHelp: "How Even mailen handles your mail and data.",
    source: "Source code",
    sourceHelp: "Every Even app is open source on GitHub.",
    view: "View",
  },
  nl: {
    about: "Over",
    app: "App",
    version: "Versie",
    versionHelp: "De versie van Even op deze computer.",
    ready: (version) => `Versie ${version} is gedownload en wordt geïnstalleerd als Even herstart.`,
    checkFailed: "Zoeken naar updates lukte niet. Probeer het zo nog eens.",
    check: "Zoek naar updates",
    checking: "Zoeken…",
    upToDate: "Bijgewerkt",
    restart: "Herstart om bij te werken",
    restarting: "Herstarten…",
    download: "Downloadpagina",
    downloadHelp: "Even voor je andere computers, op Mac en Windows.",
    open: "Openen",
    legal: "Juridisch",
    privacy: "Privacybeleid",
    privacyHelp: "Hoe Even mailen met je mail en gegevens omgaat.",
    source: "Broncode",
    sourceHelp: "Elke Even-app is open source op GitHub.",
    view: "Bekijken",
  },
}

const check = () => invoke<string | null>("check_for_update")
const install = () => invoke<void>("install_update")

/**
 * What the apps inside Even get to know about it: its version and a downloaded
 * update, for the About settings and the "Restart to update" button.
 */
export function useDesktopApp(): DesktopApp | null {
  const [version, setVersion] = useState<string | null>(null)
  const [ready, setReady] = useState<string | null>(null)
  const language = useCurrentLanguage()
  useEffect(() => {
    void getVersion().then(setVersion)
    void invoke<string | null>("ready_update").then((found) => found && setReady(found))
    const unlisten = listen<string>("update-ready", (event) => setReady(event.payload))
    return () => void unlisten.then((stop) => stop())
  }, [])
  return useMemo(
    () =>
      version
        ? {
            version,
            ready,
            check: () => check().then((found) => (found && setReady(found), found)),
            install,
            texts: TEXTS[language] ?? TEXTS.en,
          }
        : null,
    [version, ready, language]
  )
}
