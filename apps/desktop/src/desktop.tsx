import { useEffect } from "react"
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

export function Desktop() {
  useWindowDragging()
  return (
    <ThemeProvider>
      <Gate />
      <Toaster position="bottom-right" closeButton />
    </ThemeProvider>
  )
}
