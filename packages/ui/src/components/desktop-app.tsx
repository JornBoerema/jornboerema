import { createContext, useContext, useState } from "react"
import { InformationCircleIcon, RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { SettingsRow, SettingsSection, type SettingsPage } from "@evido/ui/components/settings-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@evido/ui/components/tooltip"

/** The words below, in the app's language; the desktop app supplies them. */
export type DesktopTexts = {
  about: string
  app: string
  version: string
  versionHelp: string
  ready: (version: string) => string
  checkFailed: string
  check: string
  checking: string
  upToDate: string
  restart: string
  restarting: string
  download: string
  downloadHelp: string
  open: string
  legal: string
  privacy: string
  privacyHelp: string
  source: string
  sourceHelp: string
  view: string
}

/** What the Even desktop app tells the apps it holds. */
export type DesktopApp = {
  version: string
  /** A downloaded version, waiting for a restart. */
  ready: string | null
  /** Looks for a new version and downloads it; resolves to the version that is ready, if any. */
  check: () => Promise<string | null>
  install: () => Promise<void>
  texts: DesktopTexts
}

const DesktopContext = createContext<DesktopApp | null>(null)

/** Set by the Even desktop app; on the web there is none, and all of this shows nothing. */
export const DesktopProvider = DesktopContext.Provider

/** The settings page for {@link AboutSettings}, or nothing on the web. */
export function useAboutPage(): SettingsPage | null {
  const desktop = useContext(DesktopContext)
  if (!desktop) return null
  return {
    id: "about",
    label: desktop.texts.about,
    icon: <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.75} aria-hidden="true" />,
    end: true,
  }
}

function useInstall(install: () => Promise<void>) {
  const [restarting, setRestarting] = useState(false)
  const start = () => {
    setRestarting(true)
    install().catch(() => setRestarting(false))
  }
  return [restarting, start] as const
}

/**
 * "Restart to update", on the desktop app's rail above the settings button,
 * once a new version is ready. Needs a TooltipProvider around it.
 */
export function UpdateButton() {
  const desktop = useContext(DesktopContext)
  const [restarting, install] = useInstall(desktop?.install ?? (async () => {}))
  if (!desktop?.ready) return null
  const label = restarting ? desktop.texts.restarting : desktop.texts.restart
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="app-rail-button update-button"
          aria-label={`${label}, ${desktop.ready}`}
          disabled={restarting}
          onClick={install}
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        <span>{label}</span>
        <span className="opacity-60">{desktop.ready}</span>
      </TooltipContent>
    </Tooltip>
  )
}

const LINKS = {
  download: "https://jornboerema.nl/download",
  privacy: "https://jornboerema.nl/privacy",
  source: "https://github.com/JornBoerema/jornboerema",
}

function LinkButton({ href, children }: { href: string; children: string }) {
  return (
    <Button size="sm" variant="outline" asChild>
      <a href={href} target="_blank" rel="noopener">
        {children}
      </a>
    </Button>
  )
}

/** About the desktop app: its version and updates, then where to find more. */
export function AboutSettings() {
  const desktop = useContext(DesktopContext)
  const [status, setStatus] = useState<"idle" | "checking" | "current" | "failed">("idle")
  const [restarting, install] = useInstall(desktop?.install ?? (async () => {}))
  if (!desktop) return null
  const t = desktop.texts

  const check = () => {
    setStatus("checking")
    desktop.check().then(
      (ready) => setStatus(ready ? "idle" : "current"),
      () => setStatus("failed")
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={t.app}>
        <SettingsRow
          title={t.version}
          description={desktop.ready ? t.ready(desktop.ready) : status === "failed" ? t.checkFailed : t.versionHelp}
        >
          <span className="font-mono text-xs text-muted-foreground">{desktop.version}</span>
          {desktop.ready ? (
            <Button size="sm" disabled={restarting} onClick={install}>
              {restarting ? t.restarting : t.restart}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={status === "checking"} onClick={check}>
              {status === "checking" ? t.checking : status === "current" ? t.upToDate : t.check}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow title={t.download} description={t.downloadHelp}>
          <LinkButton href={LINKS.download}>{t.open}</LinkButton>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t.legal}>
        <SettingsRow title={t.privacy} description={t.privacyHelp}>
          <LinkButton href={LINKS.privacy}>{t.view}</LinkButton>
        </SettingsRow>
        <SettingsRow title={t.source} description={t.sourceHelp}>
          <LinkButton href={LINKS.source}>{t.view}</LinkButton>
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}
