import { Activity, useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router"
import { TooltipProvider } from "@evido/ui/components/tooltip"
import { BackgroundNotifications } from "@/components/background-notifications"
import { I18nProvider } from "@/i18n"
import { Root } from "./app"
import "./mail.css"

/** Mail lost its session; the desktop app starts again at its sign-in screen. */
function SignedOut() {
  useEffect(() => window.location.reload(), [])
  return null
}

/**
 * Even mailen inside the Even desktop app. The desktop app provides the theme,
 * the toaster and the sign-in screens; this keeps its own router and cache.
 * Out of view (`active` false) the screens keep their place but pause, and only
 * new-mail notifications keep running.
 */
export function MailEmbed({ active }: { active: boolean }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } })
  )
  return (
    <I18nProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={150}>
          <Activity mode={active ? "visible" : "hidden"}>
            <MemoryRouter>
              <Routes>
                <Route index element={<Root />} />
                <Route path="*" element={<SignedOut />} />
              </Routes>
            </MemoryRouter>
          </Activity>
          {!active && <BackgroundNotifications />}
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>
  )
}
