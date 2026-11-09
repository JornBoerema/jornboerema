import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Button } from "@evido/ui/components/button"
import { Toaster } from "@evido/ui/components/sonner"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { I18nProvider, useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { useAccounts, useMailRealtime, useMailSync } from "@/lib/mail"
import { AccountsPage } from "@/pages/accounts"
import { InboxPage } from "@/pages/inbox"
import { LoginPage } from "@/pages/login"

/** A provider redirect lands here with its result, which the mailboxes view reports. */
const initialView = () => (window.location.search ? "mailboxes" : "inbox")

function MailApp({ userId, email }: { userId: string; email: string }) {
  const t = useI18n().t.shell
  const [view, setView] = useState<"inbox" | "mailboxes">(initialView)
  const accounts = useAccounts()
  const syncStatus = useMailSync(accounts.data?.accounts)
  useMailRealtime(userId)

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <nav className="flex gap-1">
          <Button variant={view === "inbox" ? "secondary" : "ghost"} onClick={() => setView("inbox")}>
            {t.inbox}
          </Button>
          <Button
            variant={view === "mailboxes" ? "secondary" : "ghost"}
            onClick={() => setView("mailboxes")}
          >
            {t.mailboxes}
          </Button>
        </nav>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {email}
          <Button size="sm" variant="ghost" onClick={() => void authClient.signOut()}>
            {t.signOut}
          </Button>
        </div>
      </header>
      {view === "inbox" ? (
        <InboxPage accounts={accounts.data?.accounts ?? []} syncStatus={syncStatus} />
      ) : (
        <AccountsPage />
      )}
    </main>
  )
}

function Root() {
  const { data, isPending } = authClient.useSession()
  if (isPending) return null
  return data ? <MailApp userId={data.user.id} email={data.user.email} /> : <LoginPage />
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
