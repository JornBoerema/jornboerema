import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { CheckmarkCircle02Icon, ComputerIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert, AlertDescription } from "@evido/ui/components/alert"
import { Button } from "@evido/ui/components/button"
import { RequireSession } from "@/components/require-session"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { here } from "@/lib/return-to"
import { useTitle } from "@/lib/use-title"

const PKCE = /^[A-Za-z0-9._~-]{43,128}$/
const STATE = /^[A-Za-z0-9_-]{16,128}$/

/** What the Even app sent along: where it listens, and the values only it can answer. */
function useRequest() {
  const [params] = useSearchParams()
  const port = Number(params.get("port"))
  const state = params.get("state") ?? ""
  const challenge = params.get("challenge") ?? ""
  const valid = Number.isInteger(port) && port >= 1024 && port <= 65535 && STATE.test(state) && PKCE.test(challenge)
  return valid ? { port, state, challenge } : null
}

/**
 * The Even desktop app signs in here: with a session in this browser, the user
 * confirms, and the app on 127.0.0.1 receives a one-time code that only it can
 * redeem (PKCE). Confirming is the guard against someone else's sign-in link.
 */
export function DesktopPage() {
  const t = useI18n().t.desktop
  useTitle(t.pageTitle)
  const request = useRequest()
  if (!request)
    return (
      <section className="auth-form">
        <div className="flex flex-col gap-2">
          <h1>{t.invalidTitle}</h1>
          <p className="text-muted-foreground">{t.invalidDescription}</p>
        </div>
      </section>
    )
  return (
    <RequireSession>
      {(session) => <Confirm email={session.user.email} request={request} />}
    </RequireSession>
  )
}

function Confirm({
  email,
  request,
}: {
  email: string
  request: { port: number; state: string; challenge: string }
}) {
  const { t: all } = useI18n()
  const t = all.desktop
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function signIn() {
    setPending(true)
    setError("")
    try {
      const { data, error } = await authClient.$fetch<{ code: string }>("/desktop/code", {
        method: "POST",
        body: { challenge: request.challenge },
      })
      if (error || !data) throw new Error()
      const callback = new URL(`http://127.0.0.1:${request.port}/callback`)
      callback.searchParams.set("code", data.code)
      callback.searchParams.set("state", request.state)
      window.location.assign(callback.toString())
    } catch {
      setError(t.failed)
      setPending(false)
    }
  }

  async function otherAccount() {
    const back = here()
    await authClient.signOut()
    navigate(`/login?returnTo=${encodeURIComponent(back)}`, { replace: true })
  }

  return (
    <section className="auth-form">
      <HugeiconsIcon icon={ComputerIcon} strokeWidth={1.75} aria-hidden="true" className="size-7 text-primary" />
      <div className="flex flex-col gap-2">
        <h1>{t.title}</h1>
        <p className="text-muted-foreground">{t.description(email)}</p>
        <p className="text-sm text-muted-foreground">{t.hint}</p>
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-3">
        <Button disabled={pending} onClick={() => void signIn()}>
          {pending && (
            <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" data-icon="inline-start" />
          )}
          {t.continue}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => void otherAccount()}>
          {t.otherAccount}
        </Button>
      </div>
    </section>
  )
}

/** Where the app sends the browser once it has the code. */
export function DesktopDonePage() {
  const t = useI18n().t.desktop
  useTitle(t.doneTitle)
  return (
    <section className="auth-form">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.75} aria-hidden="true" className="size-7 text-primary" />
      <div className="flex flex-col gap-2">
        <h1>{t.doneTitle}</h1>
        <p className="text-muted-foreground">{t.doneDescription}</p>
      </div>
    </section>
  )
}
