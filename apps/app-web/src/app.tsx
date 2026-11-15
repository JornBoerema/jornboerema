import { useEffect } from "react"
import { ComputerIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { goToSignIn } from "@even/auth/client"
import { useCurrentLanguage } from "@even/i18n/react"
import { NotesPublic } from "@even/notes-web/embed"
import { APP_PATHS, EvenShell } from "@even/shell/shell"
import { hideSplash } from "@even/shell/splash"
import { authClient, TodoPublic } from "@even/todo-web/embed"
import { Button } from "@even/ui/components/button"
import { DESKTOP_DOWNLOAD_URL } from "@even/ui/components/desktop-download"
import { Toaster } from "@even/ui/components/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@even/ui/components/tooltip"
import { ThemeProvider } from "@even/ui/lib/theme"
import { authClient as accountAuth } from "@/account/lib/auth-client"
import { ACCOUNT_PATHS, AccountSite, SESSION_PATHS } from "@/account/site"

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

/** Hides the splash once the session is known: those pages show nothing before it. */
function SplashUntilSession() {
  const { isPending } = accountAuth.useSession()
  useEffect(() => {
    if (!isPending) hideSplash()
  }, [isPending])
  return null
}

function HideSplash() {
  useEffect(hideSplash, [])
  return null
}

function Account() {
  // The account and the desktop hand-off need the session first; the splash stays
  // until then rather than giving way to an empty page. Signing in shows at once.
  const waits = SESSION_PATHS.test(window.location.pathname)
  return (
    <>
      {waits ? <SplashUntilSession /> : <HideSplash />}
      <AccountSite />
    </>
  )
}

function Public({ app }: { app: "todo" | "notes" }) {
  useEffect(hideSplash, [])
  return app === "todo" ? <TodoPublic base={APP_PATHS.todo} /> : <NotesPublic base={APP_PATHS.notes} />
}

export function App() {
  // Signing in and the account have pages of their own, with or without a session.
  if (ACCOUNT_PATHS.test(window.location.pathname)) return <Account />
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
