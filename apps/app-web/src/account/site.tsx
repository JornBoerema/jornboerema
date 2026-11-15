import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Route, Routes } from "react-router"
import { Toaster } from "@evido/ui/components/sonner"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { I18nProvider } from "@/account/i18n"
import { AccountPage } from "@/account/pages/account"
import { AuthPage } from "@/account/pages/auth"
import { ConsentPage } from "@/account/pages/consent"
import { DesktopDonePage, DesktopPage } from "@/account/pages/desktop"
import { AuthLayout } from "@/account/pages/layout"
import "./account.css"

/**
 * The addresses of signing in and the account: everything else on this site is
 * the apps. app.tsx sends these here, and pages here leave by loading the address anew.
 */
export const ACCOUNT_PATHS = /^\/(login|signup|forgot-password|reset-password|connect|desktop|account)(\/|$)/

/** Signed in, or the brand clicked: on to the apps, which load from the address. */
function ToApps() {
  useEffect(() => window.location.replace(window.location.href), [])
  return null
}

/**
 * Signing in for every Even app, the consent page for outside tools, the
 * desktop app's hand-off and the account portal.
 */
export function AccountSite() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } })
  )
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <BrowserRouter>
            <Routes>
              <Route path="account" element={<AccountPage />} />
              <Route element={<AuthLayout />}>
                <Route path="login" element={<AuthPage mode="login" />} />
                <Route path="signup" element={<AuthPage mode="register" />} />
                <Route path="forgot-password" element={<AuthPage mode="forgot" />} />
                <Route path="reset-password" element={<AuthPage mode="reset" />} />
                <Route path="connect" element={<ConsentPage />} />
                <Route path="desktop" element={<DesktopPage />} />
                <Route path="desktop/done" element={<DesktopDonePage />} />
              </Route>
              <Route path="*" element={<ToApps />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" closeButton />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
