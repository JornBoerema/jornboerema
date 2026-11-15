import { Activity, useEffect, useMemo } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Route, Routes } from "react-router"
import { EmbedRouter } from "@even/ui/components/embed-router"
import { TooltipProvider } from "@even/ui/components/tooltip"
import { useOrganizations } from "@even/ui/components/organizations"
import { setMailOrganization } from "@/lib/api"
import { MotionConfig } from "motion/react"
import { TIP_DELAY_MS } from "@/components/icon-tip"
import { BackgroundNotifications } from "@/components/background-notifications"
import { I18nProvider } from "@/i18n"
import { Root } from "./app"
import "./mail.css"

export { setMailStorage, type MailStorage } from "./lib/cache"

/** Mail lost its session; the shell starts again at signing in. */
function SignedOut() {
  useEffect(() => window.location.reload(), [])
  return null
}

/**
 * Even mailen inside the Even shell (the desktop app, and app.jornboerema.nl). The
 * shell provides the theme, the toaster and signing in; this keeps its own router and cache.
 * Out of view (`active` false) the screens keep their place but pause, and only
 * new-mail notifications keep running.
 */
export function MailEmbed({ active }: { active: boolean }) {
  // Mailboxes belong to an organization: switching it in the rail shows its mail,
  // from a cache of its own, and every request says which one it is for.
  const organizationId = useOrganizations()?.active.id ?? null
  setMailOrganization(organizationId)
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } }),
    [organizationId]
  )
  return (
    <I18nProvider>
      <QueryClientProvider client={client} key={organizationId ?? "none"}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={TIP_DELAY_MS} skipDelayDuration={400}>
          <Activity mode={active ? "visible" : "hidden"}>
            <EmbedRouter app="mail">
              <Routes>
                <Route index element={<Root />} />
                <Route path="*" element={<SignedOut />} />
              </Routes>
            </EmbedRouter>
          </Activity>
          {!active && <BackgroundNotifications />}
        </TooltipProvider>
          </MotionConfig>
      </QueryClientProvider>
    </I18nProvider>
  )
}
