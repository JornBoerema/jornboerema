import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { ArrowUpRight01Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authUrl, setSessionToken } from "@evido/auth/client"
import { currentLanguage } from "@evido/i18n/react"
import { Alert, AlertDescription } from "@evido/ui/components/alert"
import { Button } from "@evido/ui/components/button"
import { Brand } from "./brand"

const TEXTS = {
  en: {
    title: "Welcome to Even",
    description: "Sign in with your Even account. That happens in your browser, so you sign in once for every Even app.",
    signIn: "Sign in with your browser",
    waiting: "Finish signing in in your browser.",
    openAgain: "Open the browser again",
    cancel: "Cancel",
    failed: "Signing in didn't work. Try again.",
    noAccount: "No account yet?",
    createAccount: "Create one",
  },
  nl: {
    title: "Welkom bij Even",
    description: "Log in met je Even-account. Dat gaat via je browser, zo log je in één keer in voor alle Even-apps.",
    signIn: "Inloggen via je browser",
    waiting: "Rond het inloggen af in je browser.",
    openAgain: "Browser opnieuw openen",
    cancel: "Annuleren",
    failed: "Inloggen is niet gelukt. Probeer het opnieuw.",
    noAccount: "Nog geen account?",
    createAccount: "Maak er een",
  },
}

const API_URL = import.meta.env.VITE_API_URL.replace(/\/$/, "")

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const randomValue = (length: number) => base64Url(crypto.getRandomValues(new Uint8Array(length)))

async function challengeFor(verifier: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
}

/** Opens a page in the default browser: the window hands every outside link to it. */
const openInBrowser = (url: string) => window.open(url, "_blank")

type Attempt = { verifier: string; state: string; url: string }

/**
 * The sign-in screen of the desktop app. Signing in happens on the account
 * site in the browser; the app listens on 127.0.0.1 for the one-time code and
 * redeems it with the PKCE verifier only it knows.
 */
export function SignIn({ mac }: { mac: boolean }) {
  const t = TEXTS[currentLanguage()]
  const attempt = useRef<Attempt | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const stop = listen<string>("sign-in-callback", async (event) => {
      const current = attempt.current
      const params = new URLSearchParams(event.payload)
      const code = params.get("code")
      if (!current || !code || params.get("state") !== current.state) return
      attempt.current = null
      try {
        const response = await fetch(`${API_URL}/api/auth/desktop/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept-Language": currentLanguage() },
          body: JSON.stringify({ code, verifier: current.verifier }),
        })
        const token = response.headers.get("set-auth-token")
        if (!response.ok || !token) throw new Error()
        setSessionToken(token)
        // Starts the apps fresh, with the new session.
        window.location.reload()
      } catch {
        setWaiting(false)
        setError(t.failed)
      }
    })
    return () => {
      void stop.then((unlisten) => unlisten())
      void invoke("cancel_sign_in")
    }
  }, [t])

  async function start() {
    setError("")
    try {
      const verifier = randomValue(48)
      const state = randomValue(24)
      const port = await invoke<number>("listen_for_sign_in", { doneUrl: authUrl("/desktop/done") })
      const url = authUrl("/desktop", { port: String(port), state, challenge: await challengeFor(verifier) })
      attempt.current = { verifier, state, url }
      setWaiting(true)
      openInBrowser(url)
    } catch {
      setError(t.failed)
    }
  }

  function cancel() {
    attempt.current = null
    setWaiting(false)
    void invoke("cancel_sign_in")
  }

  return (
    <div className={mac ? "desktop-sign-in mac" : "desktop-sign-in"}>
      <div className="auth-layout">
        <header data-tauri-drag-region>
          <Brand />
        </header>
        <main className="auth-main">
          <section className="auth-form">
            <div className="flex flex-col gap-2">
              <h1>{t.title}</h1>
              <p className="text-muted-foreground">{waiting ? t.waiting : t.description}</p>
            </div>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {waiting ? (
              <div className="flex flex-col gap-3">
                <Button disabled>
                  <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" data-icon="inline-start" />
                  {t.signIn}
                </Button>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => attempt.current && openInBrowser(attempt.current.url)}>
                    {t.openAgain}
                  </Button>
                  <Button variant="ghost" onClick={cancel}>
                    {t.cancel}
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => void start()}>
                {t.signIn}
                <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} data-icon="inline-end" />
              </Button>
            )}
            <p className="auth-switch">
              {t.noAccount}{" "}
              <a href={authUrl("/signup")} target="_blank" rel="noopener">
                {t.createAccount}
              </a>
            </p>
          </section>
        </main>
      </div>
    </div>
  )
}
