import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { useI18n } from "@/i18n"
import { API_URL } from "@/lib/api"
import { appLinks } from "@/lib/apps"

type Billing = {
  enabled: boolean
  subscription?: {
    status: string
    interval: string | null
    periodEnd: string | null
    trialEnd: string | null
    endsAtPeriodEnd: boolean
  } | null
}

async function billing<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api/billing${path}`, { cache: "no-store", credentials: "include", ...init })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? response.statusText)
  return body
}

/** The Even mailen subscription: what it is now, and the way to Stripe's portal to change or end it. */
export function Subscription() {
  const { t: all, locale } = useI18n()
  const t = all.account
  const status = useQuery({ queryKey: ["billing"], queryFn: () => billing<Billing>(""), retry: false })
  const portal = useMutation({
    mutationFn: () =>
      billing<{ url: string }>("/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({ returnTo: window.location.href }),
      }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(error instanceof Error ? error.message : all.common.failed),
  })

  // No billing on this server, or it can't be reached: nothing to show.
  if (!status.data?.enabled) return null
  const current = status.data.subscription
  const day = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : ""
  const line = !current
    ? t.planNone
    : current.endsAtPeriodEnd
      ? t.planEnds(day(current.periodEnd))
      : current.trialEnd
        ? t.planTrial(day(current.trialEnd))
        : current.status === "past_due"
          ? t.planPastDue
          : t.planRenews(day(current.periodEnd))

  return (
    <SettingsSection title={t.plan}>
      <SettingsRow title={current ? t.planName : t.planFree} description={line}>
        {current ? (
          <Button size="sm" variant="outline" disabled={portal.isPending} onClick={() => portal.mutate()}>
            {t.planManage}
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <a href={appLinks().mail}>{t.planStart}</a>
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}
