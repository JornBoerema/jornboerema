import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MailDraftView } from "@evido/mail-core/types"
import { errorText } from "@/lib/api"
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router"
import { Toaster } from "@evido/ui/components/sonner"
import { useCollapsibleSidebar } from "@evido/ui/hooks/use-collapsible-sidebar"
import { cn } from "@evido/ui/lib/utils"
import { ThemeProvider } from "@evido/ui/lib/theme"
import type { MailThreadView } from "@evido/mail-core/types"
import { MailSettings } from "@/components/mail-settings"
import { useInvoices, useParcels, usePreferencesSync, useSenders } from "@/lib/preferences"
import { MailSpotlight } from "@/components/mail-spotlight"
import { ShortcutsSpotlight } from "@/components/shortcuts-spotlight"
import { Sidebar, type MailNavigation, type MailView } from "@/components/sidebar"
import { I18nProvider, useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { persistMailCache } from "@/lib/cache"
import { deleteDraft, DRAFTS_KEY, useDrafts, type DraftRef } from "@/lib/drafts"
import { linkedThread, useAccounts, useMailRealtime, useMailSync, useUnread } from "@/lib/mail"
import { useNewMailNotifications, useUnreadTitle } from "@/lib/notifications"
import { useSignatures } from "@/lib/signatures"
import { isWaiting } from "@/lib/undo"
import { InboxPage } from "@/pages/inbox"
import { AuthPage } from "@/pages/auth"
import { AuthLayout } from "@/pages/auth-layout"
import { AccessGate } from "@/components/access-gate"
import { TooltipProvider } from "@evido/ui/components/tooltip"
import { MotionConfig } from "motion/react"
import { TIP_DELAY_MS } from "@/components/icon-tip"

/** A provider redirect lands here with its result, which the settings report. */
const returnedFromProvider = () =>
  Boolean(window.location.search) && !new URLSearchParams(window.location.search).has("conversation")

/** Puts the lists kept in this browser back before the app shows anything. */
function WithCachedMail({ userId, children }: { userId: string; children: ReactNode }) {
  const queryClient = useQueryClient()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const { unsubscribe, restored } = persistMailCache(queryClient, userId)
    void restored.finally(() => setReady(true))
    return unsubscribe
  }, [queryClient, userId])
  return ready ? children : null
}

function MailApp({ user }: { user: { id: string; name: string; email: string } }) {
  const sidebar = useCollapsibleSidebar()
  const accounts = useAccounts()
  const list = accounts.data?.accounts ?? []
  const syncStatus = useMailSync(accounts.data?.accounts)
  usePreferencesSync()
  useMailRealtime(user.id)
  const [filter, setFilter] = useState("")
  const [view, setView] = useState<MailView>("inbox")
  // Parcels turned off, here or on another device, takes its list away.
  const parcels = useParcels()
  const tidy = useSenders()
  const invoices = useInvoices()
  useEffect(() => {
    if ((!parcels && view === "parcels") || (!tidy && view === "senders") || (!invoices && view === "invoices"))
      setView("inbox")
  }, [parcels, tidy, invoices, view])
  // A new key starts a fresh composer, for a new message or another draft.
  const [compose, setCompose] = useState<{ key: number; draft: DraftRef | null } | null>(null)
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null)
  // A link from Even doen opens its mail straight away; the address then goes back to plain.
  const [open, setOpen] = useState<MailThreadView | null>(() => linkedThread(window.location.search))
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("conversation"))
      window.history.replaceState(window.history.state, "", window.location.pathname)
  }, [])
  const [composeHidden, setComposeHidden] = useState(false)
  const hideCompose = useCallback(() => setComposeHidden(true), [])
  const showCompose = useCallback(() => {
    setOpen(null)
    setComposeHidden(false)
  }, [])
  const closeCompose = useCallback(() => {
    setCompose(null)
    setComposeDraftId(null)
    setComposeHidden(false)
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(returnedFromProvider)
  const [editingSidebar, setEditingSidebar] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const hasActive = list.some((account) => account.status === "active")
  const drafts = useDrafts(hasActive)
  // Loaded up front, so a new message has its signature from the start.
  useSignatures()
  const { t } = useI18n()
  const unread = useUnread(hasActive)
  useUnreadTitle(unread.data?.count, "Even mailen")
  const notificationTexts = useMemo(
    () => ({ newMail: t.notifications.newMail, unknownSender: t.inbox.unknownSender, noSubject: t.inbox.noSubject }),
    [t]
  )
  useNewMailNotifications(unread.data?.latest, notificationTexts, (thread) => {
    setView("inbox")
    setFilter("")
    setOpen(thread)
  })

  const queryClient = useQueryClient()
  const [discardRequest, setDiscardRequest] = useState(0)
  const removeDraft = (draft: DraftRef) => {
    if (compose && draft.id === composeDraftId) return setDiscardRequest((count) => count + 1)
    type List = { drafts: MailDraftView[]; failedAccounts: string[] }
    queryClient.setQueryData<List>(
      DRAFTS_KEY,
      (data) => data && { ...data, drafts: data.drafts.filter((item) => item.id !== draft.id) }
    )
    deleteDraft(draft)
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY }))
  }

  const startCompose = (draft: DraftRef | null) => {
    setOpen(null)
    setComposeHidden(false)
    // The draft being written is already open; bring it back instead of reloading it.
    if (compose && (draft === null ? compose.draft === null && !composeDraftId : draft.id === composeDraftId))
      return
    setComposeDraftId(draft?.id ?? null)
    setCompose((current) => ({ key: (current?.key ?? 0) + 1, draft }))
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // ? lists every shortcut, unless it is being typed or a dialog is open.
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.repeat) {
        const typing = event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable]")
        if (typing || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return
      const key = event.key.toLowerCase()
      if (key === ",") {
        event.preventDefault()
        setSettingsOpen(true)
      }
      if (key === "k") {
        // In the editor ⌘K makes a link; other dialogs keep their own keys.
        const inEditor = event.target instanceof HTMLElement && event.target.closest(".ProseMirror")
        if (inEditor || document.querySelector('[role="dialog"]:not(.list-spotlight), [role="alertdialog"]')) return
        event.preventDefault()
        setSearchOpen((current) => !current)
      }
    }
    document.addEventListener("keydown", keydown)
    // A send or move that can still be undone would otherwise go in a hurry, or not at all.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (isWaiting()) event.preventDefault()
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => {
      document.removeEventListener("keydown", keydown)
      window.removeEventListener("beforeunload", beforeUnload)
    }
  }, [])

  // Going somewhere from the sidebar puts the composer away: an empty one
  // closes, one with something in it waits as a draft to resume.
  const navigation: MailNavigation = {
    accounts: list,
    // A disconnected mailbox can't stay selected.
    accountId: list.some((account) => account.id === filter) ? filter : "",
    user,
    sidebar,
    view,
    draftCount: drafts.data?.drafts.length ?? 0,
    // An empty composer closes as soon as it is out of view, so this is always a real draft.
    draftWaiting: compose !== null && (composeHidden || open !== null),
    composing: compose !== null && !composeHidden && open === null,
    onSelectAccount: (id) => {
      setComposeHidden(true)
      setFilter(id)
      setView("inbox")
    },
    onFilterAccount: (id) => {
      setFilter(id)
      setOpen(null)
    },
    onSelectDrafts: () => {
      setComposeHidden(true)
      setFilter("")
      setView("drafts")
    },
    onSelectParcels: () => {
      setComposeHidden(true)
      setFilter("")
      setOpen(null)
      setView("parcels")
    },
    onSelectInvoices: () => {
      setComposeHidden(true)
      setFilter("")
      setOpen(null)
      setView("invoices")
    },
    onSelectSnoozed: () => {
      setComposeHidden(true)
      setFilter("")
      setOpen(null)
      setView("snoozed")
    },
    onSelectScheduled: () => {
      setComposeHidden(true)
      setFilter("")
      setOpen(null)
      setView("scheduled")
    },
    // Tidy up keeps the chosen mailbox: tidying one at a time is common.
    onSelectSenders: () => {
      setComposeHidden(true)
      setOpen(null)
      setView("senders")
    },
    onSelectFolder: (folder) => {
      setComposeHidden(true)
      setFilter("")
      setOpen(null)
      setView(folder)
    },
    onCompose: () => {
      if (!hasActive) return
      // "Resume draft" brings back the one out of view; otherwise this starts a new one.
      if (compose && (composeHidden || open !== null)) {
        setOpen(null)
        setComposeHidden(false)
      } else startCompose(null)
    },
    onSettings: () => setSettingsOpen(true),
    editingSidebar,
    // Arranged in place: the settings make way, and a collapsed sidebar opens for it.
    onCustomizeSidebar: () => {
      setSettingsOpen(false)
      if (sidebar.collapsed) sidebar.toggle()
      setEditingSidebar(true)
    },
    onDoneEditingSidebar: () => setEditingSidebar(false),
    onSearch: () => setSearchOpen(true),
    onShortcuts: () => setShortcutsOpen(true),
  }

  return (
    <div className={cn("workspace-shell mail-shell max-lg:grid-cols-[minmax(0,1fr)]!", sidebar.collapsed && "sidebar-collapsed")}>
      <Sidebar {...navigation} />
      <main className="flex min-h-0 min-w-0">
        <InboxPage
          navigation={navigation}
          syncStatus={syncStatus}
          loadingAccounts={accounts.isPending}
          open={open}
          onOpen={setOpen}
          compose={compose}
          composeHidden={composeHidden}
          composeDraftId={composeDraftId}
          drafts={drafts}
          onOpenDraft={startCompose}
          onDeleteDraft={removeDraft}
          discardRequest={discardRequest}
          onComposeDraftChange={setComposeDraftId}
          onHideCompose={hideCompose}
          onShowCompose={showCompose}
          onCloseCompose={closeCompose}
        />
      </main>
      <MailSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        user={user}
        onCustomizeSidebar={navigation.onCustomizeSidebar}
      />
      <ShortcutsSpotlight
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        onCompose={navigation.onCompose}
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      <MailSpotlight
        open={searchOpen}
        onOpenChange={setSearchOpen}
        accounts={list}
        onOpenThread={setOpen}
        onCompose={navigation.onCompose}
        onDrafts={navigation.onSelectDrafts}
        onFolder={navigation.onSelectFolder}
        onMailbox={navigation.onSelectAccount}
        onSettings={navigation.onSettings}
      />
    </div>
  )
}

/** The signed-in app, or a redirect to sign in. Also used by the desktop app. */
export function Root() {
  const { data, isPending } = authClient.useSession()
  const location = useLocation()
  if (isPending) return null
  if (data)
    return (
      <AccessGate user={data.user}>
        <WithCachedMail userId={data.user.id}>
          <MailApp user={data.user} />
        </WithCachedMail>
      </AccessGate>
    )
  // Better Auth reports a failed verification link here; "session" is a mailbox connect error.
  const error = new URLSearchParams(location.search).get("error")
  const verificationFailed = error && error !== "session"
  return <Navigate replace to={verificationFailed ? `/login?error=${encodeURIComponent(error)}` : "/login"} />
}

export function App() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } })
  )
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={TIP_DELAY_MS} skipDelayDuration={400}>
            <BrowserRouter>
              <Routes>
                <Route index element={<Root />} />
                <Route element={<AuthLayout />}>
                  <Route path="login" element={<AuthPage mode="login" />} />
                  <Route path="signup" element={<AuthPage mode="register" />} />
                  <Route path="forgot-password" element={<AuthPage mode="forgot" />} />
                  <Route path="reset-password" element={<AuthPage mode="reset" />} />
                </Route>
                <Route path="*" element={<Navigate replace to="/" />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
          </MotionConfig>
          <Toaster position="bottom-right" closeButton />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
