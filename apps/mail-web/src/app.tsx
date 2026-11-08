import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@evido/ui/components/sonner"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { I18nProvider } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { AccountsPage } from "@/pages/accounts"
import { LoginPage } from "@/pages/login"

function Root() {
  const { data, isPending } = authClient.useSession()
  if (isPending) return null
  return data ? <AccountsPage email={data.user.email} /> : <LoginPage />
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
