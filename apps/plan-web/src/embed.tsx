import { useMemo } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Route, Routes } from "react-router"
import { EmbedRouter } from "@even/ui/components/embed-router"
import { useOrganizations } from "@even/ui/components/organizations"
import { TooltipProvider } from "@even/ui/components/tooltip"
import { I18nProvider } from "@/i18n"
import { setPlanOrganization } from "@/lib/api"
import { Root } from "./app"
import "./plan.css"

/**
 * Even plannen inside the Even shell (the desktop app, and app.jornboerema.nl).
 * The shell provides the theme, the toaster and signing in; this keeps its own
 * router and cache. The calendars are those of the mailboxes in the
 * organization the rail shows.
 */
export function PlanEmbed() {
  const organizationId = useOrganizations()?.active.id ?? null
  setPlanOrganization(organizationId)
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } }),
    // A cache of its own per organization.
    [organizationId]
  )
  return (
    <I18nProvider>
      <QueryClientProvider client={client} key={organizationId ?? "none"}>
        <TooltipProvider delayDuration={500}>
          <EmbedRouter app="plan">
            <Routes>
              <Route path="*" element={<Root />} />
            </Routes>
          </EmbedRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>
  )
}
