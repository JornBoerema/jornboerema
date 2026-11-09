import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@evido/ui/components/sonner"
import { useCollapsibleSidebar } from "@evido/ui/hooks/use-collapsible-sidebar"
import { cn } from "@evido/ui/lib/utils"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { MailSettings } from "@/components/mail-settings"
import { Sidebar, type MailNavigation } from "@/components/sidebar"
import { I18nProvider } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { useAccounts, useMailRealtime, useMailSync } from "@/lib/mail"
import { ComposeDialog } from "@/pages/compose"
import { InboxPage } from "@/pages/inbox"
import { LoginPage } from "@/pages/login"

/** A provider redirect lands here with its result, which the settings report. */
const returnedFromProvider = () => Boolean(window.location.search)

function MailApp({ user }: { user: { id: string; name: string; email: string } }) {
  const sidebar = useCollapsibleSidebar()
  const accounts = useAccounts()
  const list = accounts.data?.accounts ?? []
  const syncStatus = useMailSync(accounts.data?.accounts)
  useMailRealtime(user.id)
  const [filter, setFilter] = useState("")
  const [composing, setComposing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(returnedFromProvider)
  const hasActive = list.some((account) => account.status === "active")

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "," || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setSettingsOpen(true)
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [])

  const navigation: MailNavigation = {
    accounts: list,
    // A disconnected mailbox can't stay selected.
    accountId: list.some((account) => account.id === filter) ? filter : "",
    user,
    sidebar,
    onSelectAccount: setFilter,
    onCompose: () => {
      if (hasActive) setComposing(true)
    },
    onSettings: () => setSettingsOpen(true),
  }

  return (
    <div className={cn("workspace-shell max-lg:grid-cols-[minmax(0,1fr)]!", sidebar.collapsed && "sidebar-collapsed")}>
      <Sidebar {...navigation} />
      <main className="flex min-h-0 min-w-0">
        <InboxPage navigation={navigation} syncStatus={syncStatus} loadingAccounts={accounts.isPending} />
      </main>
      {composing && <ComposeDialog accounts={list} onClose={() => setComposing(false)} />}
      <MailSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

function Root() {
  const { data, isPending } = authClient.useSession()
  if (isPending) return null
  return data ? <MailApp user={data.user} /> : <LoginPage />
}

export function App() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } })
  )
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <Root />
          <Toaster position="bottom-right" closeButton />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
