import { useEffect } from "react"
import { ComputerIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { goToSignIn } from "@evido/auth/client"
import { useCurrentLanguage } from "@evido/i18n/react"
import { NotesPublic } from "@evido/notes-web/embed"
import { APP_PATHS, EvenShell } from "@evido/shell/shell"
import { hideSplash } from "@evido/shell/splash"
import { authClient, TodoPublic } from "@evido/todo-web/embed"
import { Button } from "@evido/ui/components/button"
import { DESKTOP_DOWNLOAD_URL } from "@evido/ui/components/desktop-download"
import { Toaster } from "@evido/ui/components/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@evido/ui/components/tooltip"
import { ThemeProvider } from "@evido/ui/lib/theme"

const TEXTS = {
  en: {
    download: "Even for desktop",
    offline: "Even can't be reached",
    offlineHelp: "Check your connection and try again.",
    retry: "Try again",
  },
  nl: {
    download: "Even voor desktop",
    offline: "Even is niet bereikbaar",
    offlineHelp: "Controleer je verbinding en probeer het opnieuw.",
    retry: "Opnieuw proberen",
  },
}

/**
 * A shared list or note and an invitation are for people without the app
 * around them, some without an account: they show on their own.
 */
const PUBLIC = /^\/(todo|notes)\/(shared|invite|login|signup)(\/|$)/

/** In the rail, above the settings: the desktop app, for those who are here in a browser. */
function DownloadButton({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a className="app-rail-button app-rail-download" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener" aria-label={label}>
          <HugeiconsIcon icon={ComputerIcon} strokeWidth={1.75} aria-hidden="true" />
        </a>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** The apps with a session; without one, the account site, which sends people back here. */
function Gate() {
  const { data, isPending, error } = authClient.useSession()
  const t = TEXTS[useCurrentLanguage()] ?? TEXTS.en
  const signedOut = !isPending && !data && !error
  useEffect(() => {
    if (signedOut) goToSignIn()
  }, [signedOut])
  useEffect(() => {
    // Signed out, the splash stays until the account site takes over.
    if (!isPending && !signedOut) hideSplash()
  }, [isPending, signedOut])
  if (isPending || signedOut) return null
  if (!data)
    return (
      <main className="app-notice">
        <h1>{t.offline}</h1>
        <p>{t.offlineHelp}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t.retry}
        </Button>
      </main>
    )
  return <EvenShell web railFoot={<DownloadButton label={t.download} />} />
}

function Public({ app }: { app: "todo" | "notes" }) {
  useEffect(hideSplash, [])
  return app === "todo" ? <TodoPublic base={APP_PATHS.todo} /> : <NotesPublic base={APP_PATHS.notes} />
}

export function App() {
  const open = PUBLIC.exec(window.location.pathname)
  // Those pages bring their own theme and toaster, as they do on the apps' own sites.
  if (open) return <Public app={open[1] as "todo" | "notes"} />
  return (
    <ThemeProvider>
      <Gate />
      <Toaster position="bottom-right" closeButton />
    </ThemeProvider>
  )
}
