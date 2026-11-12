import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { Toaster } from "@evido/ui/components/sonner"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { I18nProvider } from "@/i18n"
import { AccountPage } from "@/pages/account"
import { AuthPage } from "@/pages/auth"
import { ConsentPage } from "@/pages/consent"
import { DesktopDonePage, DesktopPage } from "@/pages/desktop"
import { AuthLayout } from "@/pages/layout"

export function App() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } })
  )
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <BrowserRouter>
            <Routes>
              <Route index element={<AccountPage />} />
              <Route element={<AuthLayout />}>
                <Route path="login" element={<AuthPage mode="login" />} />
                <Route path="signup" element={<AuthPage mode="register" />} />
                <Route path="forgot-password" element={<AuthPage mode="forgot" />} />
                <Route path="reset-password" element={<AuthPage mode="reset" />} />
                <Route path="connect" element={<ConsentPage />} />
                <Route path="desktop" element={<DesktopPage />} />
                <Route path="desktop/done" element={<DesktopDonePage />} />
              </Route>
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" closeButton />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
