import { Component, useEffect, type ReactNode } from "react"
import { authClient } from "@even/todo-web/embed"
import { EvenShell } from "@even/shell/shell"
import { hideSplash } from "@even/shell/splash"
import { Toaster } from "@even/ui/components/sonner"
import { ThemeProvider } from "@even/ui/lib/theme"
import { forgetMailOnDisk } from "./mail-storage"
import { SignIn } from "./sign-in"
import { useDesktopApp } from "./updates"
import { useWindowDragging } from "./window"

const isMac = navigator.userAgent.includes("Mac")

/** The apps, with this computer's version of Even and its updates in the settings. */
function Apps() {
  const desktop = useDesktopApp()
  return <EvenShell desktop={desktop} />
}

function Gate() {
  const { data, isPending, error } = authClient.useSession()
  // Only when the API says there is no session; offline, the cache is what shows.
  const signedOut = !isPending && !data && !error
  useEffect(() => {
    if (signedOut) void forgetMailOnDisk()
  }, [signedOut])
  useEffect(() => {
    if (!isPending) hideSplash()
  }, [isPending])
  if (isPending) return <div className="desktop-loading" data-tauri-drag-region />
  if (!data) return <SignIn mac={isMac} />
  return <Apps />
}

/**
 * Without this a crash while the apps start leaves an empty root under the
 * splash, which then never leaves. Now the splash goes and the error shows, so
 * it can be reported (and the devtools, F12 or ⌥⌘I, have the rest).
 */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(error)
    hideSplash()
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-tauri-drag-region>
        <p className="font-medium">Even kon niet starten.</p>
        <pre className="max-w-full overflow-auto rounded-md bg-muted p-3 text-left text-xs whitespace-pre-wrap select-text">
          {`${error.name}: ${error.message}\n${error.stack ?? ""}`}
        </pre>
        <button className="text-sm underline" onClick={() => window.location.reload()}>
          Opnieuw proberen
        </button>
      </div>
    )
  }
}

export function Desktop() {
  useWindowDragging()
  return (
    <ThemeProvider>
      <Crash>
        <Gate />
      </Crash>
      <Toaster position="bottom-right" closeButton />
    </ThemeProvider>
  )
}
