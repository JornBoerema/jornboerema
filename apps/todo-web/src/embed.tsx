import { useEffect, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MotionConfig } from "motion/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router"
import { I18nProvider } from "./i18n"
import { HomePage } from "./pages/home"
import { AuthPage } from "./pages/auth"
import "./app.css"

export { authClient } from "./lib/auth-client"

/** The lists lost their session; the desktop app starts again at its sign-in screen. */
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
 * Even doen inside the Even desktop app. The desktop app provides the theme,
 * the toaster and the sign-in screens; this keeps its own router and cache.
 */
export function TodoEmbed() {
  const client = useQueryClient()
  return (
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MotionConfig reducedMotion="user">
          <MemoryRouter>
            <Routes>
              <Route index element={<HomePage />} />
              <Route path="*" element={<SignedOut />} />
            </Routes>
          </MemoryRouter>
        </MotionConfig>
      </QueryClientProvider>
    </I18nProvider>
  )
}

/** The web layout without the Even doen brand and tagline: the desktop app brings its own. */
function SignInLayout({ brand }: { brand: ReactNode }) {
  return (
    <div className="auth-layout">
      <header data-tauri-drag-region>{brand}</header>
      <main className="auth-main">
        <Outlet />
      </main>
    </div>
  )
}

/** The sign-in, sign-up and forgot-password screens, for the desktop app. */
export function TodoSignIn({ brand }: { brand: ReactNode }) {
  const client = useQueryClient()
  return (
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route element={<SignInLayout brand={brand} />}>
              <Route path="login" element={<AuthPage mode="login" />} />
              <Route path="signup" element={<AuthPage mode="register" />} />
              <Route path="forgot-password" element={<AuthPage mode="forgot" />} />
            </Route>
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>
  )
}
