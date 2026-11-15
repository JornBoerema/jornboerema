import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { isDesktop, webUrl } from "@even/auth/client"
import type { WorkspaceSummary } from "@even/todo-core/workspaces"
import { Button } from "@even/ui/components/button"
import {
  SettingsRow,
  SettingsSection,
} from "@even/ui/components/settings-dialog"
import { Skeleton } from "@even/ui/components/skeleton"
import { apiFetch } from "@/lib/api"
import { useI18n } from "@/i18n"

type Billing = {
  enabled: boolean
  organization?: {
    id: string
    name: string
    personal: boolean
    members: number
    manages: boolean
  }
  prices?: { currency: string; monthly: number; yearly: number } | null
  trialDays?: number
  trialAvailable?: boolean
  subscription?: {
    status: string
    interval: string | null
    seats: number
    periodEnd: string | null
    trialEnd: string | null
    endsAtPeriodEnd: boolean
  } | null
}

async function billing<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/billing${path}`, init)
  const body = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? response.statusText)
  return body
}

/**
 * Stripe's pages open in the browser. On the web they come back here; the desktop
 * app can't be returned to, so there they come back to the web app.
 */
function goTo(url: string) {
  if (isDesktop()) window.open(url, "_blank")
  else window.location.assign(url)
}
const returnTo = () =>
  isDesktop() ? webUrl("/dashboard") : window.location.href

/** Even Pro for the active organization: one seat per member, managed by its owners and admins. */
export function OrganizationBillingSettings({
  workspace,
}: {
  workspace: WorkspaceSummary
}) {
  const { t, locale } = useI18n()
  const b = t.settings.billing
  const query = `?organizationId=${encodeURIComponent(workspace.id)}`
  const status = useQuery({
    queryKey: ["billing", workspace.id],
    queryFn: () => billing<Billing>(query),
    retry: false,
  })
  const post = (path: string, body: object) =>
    billing<{ url: string }>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        organizationId: workspace.id,
        returnTo: returnTo(),
      }),
    })
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : t.settings.common.failed
    )
  const checkout = useMutation({
    mutationFn: (annual: boolean) => post("/checkout", { annual }),
    onSuccess: ({ url }) => goTo(url),
    onError,
  })
  const portal = useMutation({
    mutationFn: () => post("/portal", {}),
    onSuccess: ({ url }) => goTo(url),
    onError,
  })

  const help = workspace.personal ? b.personalHelp : b.help
  if (status.isPending)
    return (
      <SettingsSection title={b.title} description={help}>
        <Skeleton className="h-10 w-full" />
      </SettingsSection>
    )
  const data = status.data
  if (!data?.enabled || !data.organization)
    return (
      <SettingsSection title={b.title} description={b.unavailable}>
        {null}
      </SettingsSection>
    )

  const current = data.subscription
  const day = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString(locale, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : ""
  const line = !current
    ? b.none
    : current.endsAtPeriodEnd
      ? b.ends(day(current.periodEnd))
      : current.trialEnd
        ? b.trial(day(current.trialEnd))
        : current.status === "past_due"
          ? b.pastDue
          : b.renews(day(current.periodEnd))
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: data.prices?.currency ?? "eur",
    }).format(cents / 100)
  const busy = checkout.isPending || portal.isPending

  return (
    <SettingsSection title={b.title} description={help}>
      <SettingsRow
        title={current ? `${b.title} · ${b.seats(current.seats)}` : b.title}
        description={
          data.organization.manages ? line : `${line} ${b.managersOnly}`
        }
      >
        {data.organization.manages && current && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => portal.mutate()}
          >
            {b.manage}
          </Button>
        )}
      </SettingsRow>
      {data.organization.manages && !current && data.prices && (
        <SettingsRow
          title={b.seats(data.organization.members)}
          description={[
            b.price(money(data.prices.monthly), b.month),
            data.trialAvailable && data.trialDays
              ? b.trialDays(data.trialDays)
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => checkout.mutate(false)}
            >
              {b.startMonthly}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => checkout.mutate(true)}
            >
              {b.startYearly} · {money(data.prices.yearly)}
            </Button>
          </div>
        </SettingsRow>
      )}
    </SettingsSection>
  )
}
