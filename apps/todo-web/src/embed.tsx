import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MotionConfig } from "motion/react"
import { BrowserRouter, Route, Routes } from "react-router"
import { ToAccountSite } from "@evido/ui/components/account-site"
import { EmbedRouter } from "@evido/ui/components/embed-router"
import { I18nProvider } from "./i18n"
import { HomePage } from "./pages/home"
import { AuthLayout } from "./pages/auth-layout"
import { InvitationPage } from "./pages/invitation"
import { SharedListPage } from "./pages/shared-list"
import { Providers } from "./providers"
import { DesktopSettingsNav } from "./components/settings/workspace-settings"
import "./app.css"

export { authClient } from "./lib/auth-client"

/** The lists lost their session; the shell starts again at signing in. */
function SignedOut() {
  useEffect(() => window.location.reload(), [])
  return null
}

function useQueryClient() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } })
  )
  return client
}

/**
 * Even doen inside the Even shell (the desktop app, and app.jornboerema.nl). The shell
 * provides the theme, the toaster and signing in; this keeps its own router and cache.
 */
export function TodoEmbed() {
  const client = useQueryClient()
  return (
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MotionConfig reducedMotion="user">
          <EmbedRouter app="todo" query>
            <Routes>
              <Route index element={<HomePage />} />
              <Route path="*" element={<SignedOut />} />
            </Routes>
          </EmbedRouter>
        </MotionConfig>
      </QueryClientProvider>
    </I18nProvider>
  )
}

/**
 * The lists' pages in the desktop app's settings. Rendered by the desktop app from
 * the start, outside the lists, so their pages are there as soon as the window opens.
 */
export function TodoSettingsNav() {
  return (
    <I18nProvider>
      <DesktopSettingsNav />
    </I18nProvider>
  )
}

/** Leaves these pages for the app itself, which the shell holds. */
function ToApp({ base }: { base: string }) {
  useEffect(() => window.location.replace(base), [base])
  return null
}

/**
 * The pages people reach without the app around them: a shared link and an
 * invitation. On the web the shell shows these on their own, under `base`.
 */
export function TodoPublic({ base }: { base: string }) {
  return (
    <Providers>
      <BrowserRouter basename={base}>
        <Routes>
          <Route path="shared/:token" element={<SharedListPage />} />
          {/* An invitation offers both; the account site sends people back to it. */}
          <Route path="login" element={<ToAccountSite path="/login" base={base} />} />
          <Route path="signup" element={<ToAccountSite path="/signup" base={base} />} />
          <Route element={<AuthLayout />}>
            <Route path="invite/:token" element={<InvitationPage />} />
          </Route>
          <Route path="*" element={<ToApp base={base} />} />
        </Routes>
      </BrowserRouter>
    </Providers>
  )
}
