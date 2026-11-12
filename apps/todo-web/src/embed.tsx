import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MotionConfig } from "motion/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { I18nProvider } from "./i18n"
import { HomePage } from "./pages/home"
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
 * the toaster and signing in (through the browser); this keeps its own router and cache.
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
