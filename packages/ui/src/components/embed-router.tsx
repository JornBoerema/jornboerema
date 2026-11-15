import * as React from "react"
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router"
import { useAppSwitcher } from "@evido/ui/components/app-switcher"

/**
 * The router of an app that runs inside the Even shell, next to the other apps.
 *
 * Every app keeps its own in-memory router, so a hidden app stays where it was.
 * In the desktop app that is all. On the web the shell gives each app a path
 * ("/todo"), and the app that is in front also owns the browser's address:
 * what it shows is written there, and Back, Forward and a pasted link reach it.
 *
 * `query` is for apps that keep what they show in the query (?list=…). An app
 * without it only owns its path, and reads or clears the query itself.
 */
export function EmbedRouter({
  app,
  query = false,
  children,
}: {
  app: string
  query?: boolean
  children: React.ReactNode
}) {
  const switcher = useAppSwitcher()
  const base = switcher?.paths?.[app]
  // Opened from another app at a place of its own: start there.
  const [asked] = React.useState(() =>
    switcher?.request?.app === app ? switcher.request : null
  )
  const [initial] = React.useState(
    () => asked?.to || (base && query && addressUnder(base)) || "/"
  )
  return (
    <MemoryRouter initialEntries={[initial]}>
      <FollowRequests app={app} handled={asked?.n ?? 0} />
      {base && <AddressBridge app={app} base={base} query={query} />}
      {children}
    </MemoryRouter>
  )
}

/** Another app asked to show a place in this one (the shell's `open`): go there. */
function FollowRequests({ app, handled }: { app: string; handled: number }) {
  const request = useAppSwitcher()?.request
  const navigate = useNavigate()
  const last = React.useRef(handled)
  React.useEffect(() => {
    if (!request || request.app !== app || request.n <= last.current) return
    last.current = request.n
    navigate(request.to)
  }, [request, app, navigate])
  return null
}

/** "/todo/" and "/todo" are the same place. */
const pathNow = () => window.location.pathname.replace(/\/+$/, "") || "/"

/** What the browser's address says below `base`, as the app's router would write it; null when it is elsewhere. */
function addressUnder(base: string) {
  const path = pathNow()
  if (path !== base && !path.startsWith(`${base}/`)) return null
  return (
    (path.slice(base.length) || "/") +
    window.location.search +
    window.location.hash
  )
}

function AddressBridge({
  app,
  base,
  query,
}: {
  app: string
  base: string
  query: boolean
}) {
  // Not "is it running": while the settings are open every app runs, and only one may own the address.
  const active = useAppSwitcher()?.active === app
  const location = useLocation()
  const navigate = useNavigate()
  const type = useNavigationType()
  const shown = location.pathname + location.search + location.hash

  // What the app shows goes to the address bar.
  React.useEffect(() => {
    if (!active) return
    const under = addressUnder(base)
    if (!query) {
      // Coming from another app is a step Back can undo.
      if (under === null)
        window.history.pushState(window.history.state, "", base)
      return
    }
    if (under === shown) return
    const target =
      base + (shown.startsWith("/?") || shown === "/" ? shown.slice(1) : shown)
    const step =
      under === null || type === "PUSH" ? "pushState" : "replaceState"
    window.history[step](window.history.state, "", target)
  }, [active, base, query, shown, type])

  // Back and Forward move the app to what the address says.
  React.useEffect(() => {
    if (!active || !query) return
    const follow = () => {
      const under = addressUnder(base)
      if (under !== null && under !== shown) navigate(under, { replace: true })
    }
    window.addEventListener("popstate", follow)
    return () => window.removeEventListener("popstate", follow)
  }, [active, base, query, shown, navigate])

  return null
}
