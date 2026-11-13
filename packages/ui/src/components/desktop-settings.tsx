import * as React from "react"
import { createPortal } from "react-dom"
import { SettingsDialog, type SettingsLabels, type SettingsPage } from "@evido/ui/components/settings-dialog"

/**
 * One settings window for every app in the Even desktop app.
 *
 * Each app still owns its pages: it registers them with {@link DesktopSettingsPages}
 * from inside its own tree and draws the open page there, through a portal, so the
 * page keeps the app's cache, language and state. The desktop app holds the window.
 *
 * Pages with a `group` belong to that app and are listed under its name. Pages
 * without one are shared ("General"): the same id from several apps is one page,
 * which shows each app's part one below the other, in rail order.
 */

type App = { id: string; name: string }

/** Which page is open: an app's own page, or a shared one (`app` only says whose default to use). */
type Target = { app: string; page: string | null }

type DesktopSettingsState = {
  open: boolean
  /** The page key that is showing, once known. */
  activeKey: string | null
  openSettings: (app: string, page?: string | null) => void
  close: () => void
  register: (app: string, pages: SettingsPage[]) => void
  /** Where each app draws its part of the open page. */
  slots: Record<string, HTMLElement | null>
}

const Context = React.createContext<DesktopSettingsState | null>(null)

const keyOf = (app: string, page: SettingsPage) => (page.group ? `${app}:${page.id}` : page.id)

/** Holds the window. Set by the Even desktop app around all of its apps. */
export function DesktopSettingsProvider({
  apps,
  open,
  onOpenChange,
  labels,
  children,
}: {
  /** In rail order. */
  apps: App[]
  open: boolean
  onOpenChange: (open: boolean) => void
  labels?: Partial<SettingsLabels>
  children: React.ReactNode
}) {
  const [registered, setRegistered] = React.useState<Record<string, SettingsPage[]>>({})
  const [target, setTarget] = React.useState<Target>({ app: apps[0]?.id ?? "", page: null })
  const [slots, setSlots] = React.useState<Record<string, HTMLElement | null>>({})

  // The nav: shared pages first, merged by id, then each app's own under its name.
  const shared: SettingsPage[] = []
  const own: SettingsPage[] = []
  for (const app of apps) {
    for (const page of registered[app.id] ?? []) {
      if (!page.group) {
        if (!shared.some((item) => item.id === page.id)) shared.push(page)
      } else own.push({ ...page, id: keyOf(app.id, page), group: app.name })
    }
  }
  const pages = [...shared, ...own]

  // The asked-for page; without one, the first page (the account).
  const wanted = target.page
    ? (registered[target.app] ?? []).find((page) => page.id === target.page)
    : undefined
  const activeKey = wanted
    ? keyOf(target.app, wanted)
    : pages.some((page) => page.id === target.page)
      ? target.page
      : (pages[0]?.id ?? null)

  const register = React.useCallback((app: string, list: SettingsPage[]) => {
    setRegistered((current) => ({ ...current, [app]: list }))
  }, [])
  const openRef = React.useRef(open)
  openRef.current = open
  const openSettings = React.useCallback(
    (app: string, page: string | null = null) => {
      // ⌘, while it is open leaves the page as it is.
      if (openRef.current && page === null) return
      setTarget({ app, page })
      onOpenChange(true)
    },
    [onOpenChange]
  )
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])

  const slotRefs = React.useRef<Record<string, (element: HTMLElement | null) => void>>({})
  const slotRef = (app: string) =>
    (slotRefs.current[app] ??= (element) =>
      setSlots((current) => (current[app] === element ? current : { ...current, [app]: element })))

  const state = React.useMemo(
    () => ({ open, activeKey, openSettings, close, register, slots }),
    [open, activeKey, openSettings, close, register, slots]
  )
  // Every app that has a part in the open page, in rail order.
  const contributors = apps.filter((app) =>
    (registered[app.id] ?? []).some((page) => keyOf(app.id, page) === activeKey)
  )

  return (
    <Context.Provider value={state}>
      {children}
      <SettingsDialog
        open={open}
        onOpenChange={onOpenChange}
        pages={pages}
        activePage={activeKey ?? ""}
        onActivePageChange={(key) => {
          const [app, page] = key.includes(":") ? key.split(":") : [target.app, key]
          setTarget({ app: app!, page: page! })
        }}
        labels={labels}
      >
        {contributors.map((app) => (
          <div key={app.id} ref={slotRef(app.id)} className="flex flex-col gap-8" />
        ))}
      </SettingsDialog>
    </Context.Provider>
  )
}

/** Opens the desktop app's settings for `app`; null on the web, where the app has its own. */
export function useDesktopSettings(app: string) {
  const state = React.useContext(Context)
  return React.useMemo(
    () =>
      state && {
        open: (page?: string | null) => state.openSettings(app, page ?? null),
        close: state.close,
        isOpen: state.open,
      },
    [state, app]
  )
}

/**
 * An app's pages in the desktop app's settings. Rendered from inside the app,
 * so `children(page)` reaches the app's state; it shows only while one of these
 * pages is open.
 */
export function DesktopSettingsPages({
  app,
  pages,
  children,
}: {
  app: string
  pages: SettingsPage[]
  children: (page: string) => React.ReactNode
}) {
  const state = React.useContext(Context)
  const register = state?.register
  // Icons are elements, new every render: the ids, labels and groups say when the list changed.
  const signature = pages.map((page) => [page.id, page.label, page.group ?? ""].join("\u0000")).join("\u0001")
  const latest = React.useRef(pages)
  latest.current = pages
  // Registered pages stay when this unmounts: a hidden app (<Activity>) drops its
  // effects, and its pages would otherwise leave the window until it runs again.
  React.useEffect(() => {
    register?.(app, latest.current)
  }, [register, app, signature])

  const slot = state?.slots[app]
  const page = state?.open ? pages.find((item) => keyOf(app, item) === state.activeKey) : undefined
  if (!slot || !page) return null
  return createPortal(children(page.id), slot)
}
