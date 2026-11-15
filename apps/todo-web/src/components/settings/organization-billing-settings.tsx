import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { isDesktop, webUrl } from "@even/auth/client"
import type { WorkspaceSummary } from "@even/todo-core/workspaces"
import { Badge } from "@even/ui/components/badge"
import { Button } from "@even/ui/components/button"
import { SettingsRow, SettingsSection } from "@even/ui/components/settings-dialog"
import { Skeleton } from "@even/ui/components/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@even/ui/components/tabs"
import { Check, CreditCard, Download } from "@/components/icons"
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

type PaymentMethod =
  | { type: "card"; brand: string; last4: string; expMonth: number; expYear: number }
  | { type: "sepa_debit"; last4: string }
  | { type: "link"; email: string }
  | { type: string }

type Details = {
  customer: { name: string | null; email: string | null; address: string[]; taxIds: string[] } | null
  paymentMethod: PaymentMethod | null
  upcoming: { amount: number; currency: string; date: number | null } | null
  invoices: {
    id: string
    number: string | null
    date: number
    amount: number
    currency: string
    status: "paid" | "open" | "uncollectible" | string
    pdf: string | null
    url: string | null
  }[]
}

type Flow = "payment_method" | "switch" | "cancel"

async function billing<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/billing${path}`, init)
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
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
const returnTo = () => (isDesktop() ? webUrl("/dashboard") : window.location.href)

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  maestro: "Maestro",
  discover: "Discover",
  unionpay: "UnionPay",
  jcb: "JCB",
  diners: "Diners Club",
  cartes_bancaires: "Cartes Bancaires",
}

/**
 * Billing for the active organization, as any subscription app has it: the plan and
 * what it costs, the seats, how it is paid, who the invoices are for and the invoices
 * themselves. Owners and admins manage it; Stripe's portal does the editing.
 */
export function OrganizationBillingSettings({
  workspace,
  onShowMembers,
}: {
  workspace: WorkspaceSummary
  /** Opens the members page, where seats come from. */
  onShowMembers: () => void
}) {
  const { t, locale } = useI18n()
  const b = t.settings.billing
  const queryClient = useQueryClient()
  const query = `?organizationId=${encodeURIComponent(workspace.id)}`
  const status = useQuery({
    queryKey: ["billing", workspace.id],
    queryFn: () => billing<Billing>(query),
    retry: false,
  })
  const manages = Boolean(status.data?.enabled && status.data.organization?.manages)
  const details = useQuery({
    queryKey: ["billing", workspace.id, "details"],
    queryFn: () => billing<Details>(`/details${query}`),
    enabled: manages,
    retry: false,
  })
  const post = <T,>(path: string, body: object) =>
    billing<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, organizationId: workspace.id, returnTo: returnTo() }),
    })
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t.settings.common.failed)
  const checkout = useMutation({
    mutationFn: (annual: boolean) => post<{ url: string }>("/checkout", { annual }),
    onSuccess: ({ url }) => goTo(url),
    onError,
  })
  const portal = useMutation({
    mutationFn: (flow?: Flow) => post<{ url: string }>("/portal", flow ? { flow } : {}),
    onSuccess: ({ url }) => goTo(url),
    onError,
  })
  const resume = useMutation({
    mutationFn: () => post<{ ok: true }>("/resume", {}),
    onSuccess: () => {
      toast.success(b.resumed)
      void queryClient.invalidateQueries({ queryKey: ["billing", workspace.id] })
    },
    onError,
  })
  const busy = checkout.isPending || portal.isPending || resume.isPending
  const [annual, setAnnual] = useState(false)

  const help = workspace.personal ? b.personalHelp : b.help
  if (status.isPending)
    return (
      <SettingsSection title={b.title} description={help}>
        <div className="flex flex-col gap-3 px-5 py-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-52" />
        </div>
      </SettingsSection>
    )
  const data = status.data
  if (!data?.enabled || !data.organization)
    return (
      <SettingsSection title={b.title} description={b.unavailable}>
        {null}
      </SettingsSection>
    )

  const organization = data.organization
  const current = data.subscription
  const prices = data.prices
  const currency = prices?.currency ?? "eur"
  const money = (cents: number, code = currency) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(cents / 100)
  const day = (value: string | number | null | undefined) =>
    value
      ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleDateString(locale, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : ""
  const saving = prices ? Math.round((1 - prices.yearly / (prices.monthly * 12)) * 100) : 0

  // No subscription: what there is, side by side, and the way in.
  if (!current)
    return (
      <SettingsSection
        title={b.title}
        description={help}
        action={
          prices && (
            <Tabs value={annual ? "yearly" : "monthly"} onValueChange={(value) => setAnnual(value === "yearly")}>
              <TabsList>
                <TabsTrigger value="monthly">{b.monthly}</TabsTrigger>
                <TabsTrigger value="yearly">
                  {b.yearly}
                  {saving > 0 && <span className="text-xs text-muted-foreground">−{saving}%</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )
        }
      >
        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <PlanCard
            name={b.free}
            tagline={b.freeTagline}
            price={money(0)}
            unit={b.perSeat(annual ? b.year : b.month)}
            features={b.freeFeatures}
          >
            <Button variant="outline" disabled className="w-full">
              {b.current}
            </Button>
          </PlanCard>
          <PlanCard
            name={b.pro}
            tagline={b.proTagline}
            price={prices ? money(annual ? prices.yearly : prices.monthly) : "—"}
            unit={b.perSeat(annual ? b.year : b.month)}
            features={b.proFeatures}
            highlight
          >
            {organization.manages ? (
              <div className="flex flex-col gap-2">
                <Button className="w-full" disabled={busy || !prices} onClick={() => checkout.mutate(annual)}>
                  {data.trialAvailable && data.trialDays ? b.startTrial(data.trialDays) : b.subscribe}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {data.trialAvailable && data.trialDays ? `${b.trialNote(data.trialDays)} ` : ""}
                  {b.seatsNote(organization.members)}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{b.managersOnly}</p>
            )}
          </PlanCard>
        </div>
      </SettingsSection>
    )

  const yearly = current.interval === "year"
  const period = yearly ? b.year : b.month
  const seatPrice = prices ? (yearly ? prices.yearly : prices.monthly) : null
  const upcoming = details.data?.upcoming
  const badge = current.endsAtPeriodEnd
    ? { label: b.status.ending, variant: "outline" as const }
    : current.status === "past_due"
      ? { label: b.status.past_due, variant: "destructive" as const }
      : current.status === "trialing"
        ? { label: b.status.trialing, variant: "secondary" as const }
        : { label: b.status.active, variant: "secondary" as const }
  const lines = current.endsAtPeriodEnd
    ? [b.ends(day(current.periodEnd))]
    : current.status === "past_due"
      ? [b.pastDue]
      : [
          current.trialEnd ? b.trialEnds(day(current.trialEnd)) : "",
          upcoming
            ? b.nextInvoice(money(upcoming.amount, upcoming.currency), day(upcoming.date))
            : current.trialEnd
              ? ""
              : b.renews(day(current.periodEnd)),
        ].filter(Boolean)

  return (
    <>
      <SettingsSection
        title={b.title}
        description={help}
        action={
          organization.manages && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => portal.mutate(undefined)}>
              {b.manage}
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">{b.pro}</span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            {seatPrice !== null && (
              <p className="text-sm text-muted-foreground">{b.breakdown(current.seats, money(seatPrice), period)}</p>
            )}
            {lines.map((line) => (
              <p key={line} className={current.status === "past_due" ? "text-sm text-destructive" : "text-sm"}>
                {line}
              </p>
            ))}
          </div>
          {seatPrice !== null && (
            <div className="flex shrink-0 flex-col sm:items-end">
              <span className="text-2xl font-semibold tracking-tight tabular-nums">
                {money(seatPrice * current.seats)}
              </span>
              <span className="text-xs text-muted-foreground">{b.total(period)}</span>
            </div>
          )}
        </div>
        {organization.manages && (
          <div className="flex flex-wrap items-center justify-end gap-2 bg-muted/30 px-5 py-3">
            {current.endsAtPeriodEnd ? (
              <Button size="sm" disabled={busy} onClick={() => resume.mutate()}>
                {b.resume}
              </Button>
            ) : current.status === "past_due" ? (
              <Button size="sm" disabled={busy} onClick={() => portal.mutate("payment_method")}>
                {b.updatePayment}
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => portal.mutate("switch")}>
                {yearly ? b.switchMonthly : b.switchYearly}
                {!yearly && saving > 0 && <span className="text-muted-foreground">−{saving}%</span>}
              </Button>
            )}
          </div>
        )}
        {!organization.manages && <SettingsRow title={b.managersOnly} />}
      </SettingsSection>

      <SettingsSection title={b.seats}>
        <SettingsRow
          title={workspace.personal ? b.personalSeat : b.seatCount(current.seats)}
          description={workspace.personal ? undefined : b.seatsHelp}
        >
          {!workspace.personal && (
            <Button size="sm" variant="outline" onClick={onShowMembers}>
              {b.manageMembers}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>

      {organization.manages && (
        <BillingDetails
          details={details}
          busy={busy}
          onPortal={(flow) => portal.mutate(flow)}
          money={money}
          day={day}
        />
      )}

      {organization.manages && !current.endsAtPeriodEnd && (
        <SettingsSection title={t.settings.common.dangerZone} destructive>
          <SettingsRow title={b.cancel} description={b.cancelHelp}>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => portal.mutate("cancel")}
            >
              {b.cancel}
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
    </>
  )
}

function PlanCard({
  name,
  tagline,
  price,
  unit,
  features,
  highlight,
  children,
}: {
  name: string
  tagline: string
  price: string
  unit: string
  features: string[]
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={highlight ? "flex flex-col gap-5 bg-muted/30 p-5" : "flex flex-col gap-5 p-5"}>
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold">{name}</span>
        <span className="text-sm text-muted-foreground">{tagline}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{price}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <ul className="flex flex-1 flex-col gap-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  )
}

/** How it is paid, who the invoices are for, and the invoices: only for those who pay. */
function BillingDetails({
  details,
  busy,
  onPortal,
  money,
  day,
}: {
  details: ReturnType<typeof useQuery<Details>>
  busy: boolean
  onPortal: (flow?: Flow) => void
  money: (cents: number, currency?: string) => string
  day: (value: number) => string
}) {
  const b = useI18n().t.settings.billing
  if (details.isPending)
    return (
      <SettingsSection title={b.payment}>
        <div className="flex flex-col gap-2 px-5 py-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </SettingsSection>
    )
  if (!details.data)
    return (
      <SettingsSection title={b.payment} description={b.failed}>
        {null}
      </SettingsSection>
    )
  const { paymentMethod: method, customer, invoices } = details.data
  const describe = (): { title: string; description?: string } => {
    if (!method) return { title: b.noPayment }
    if (method.type === "card" && "last4" in method && "brand" in method)
      return {
        title: b.card(BRANDS[method.brand] ?? method.brand, method.last4),
        description: b.expires(method.expMonth, method.expYear),
      }
    if (method.type === "sepa_debit" && "last4" in method) return { title: b.sepa(method.last4) }
    if (method.type === "link" && "email" in method) return { title: b.link, description: method.email }
    return { title: b.otherMethod }
  }
  const shown = describe()

  return (
    <>
      <SettingsSection title={b.payment} description={b.paymentHelp}>
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <CreditCard className="size-4" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{shown.title}</span>
              {shown.description && <span className="text-sm text-muted-foreground">{shown.description}</span>}
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onPortal("payment_method")}>
            {b.update}
          </Button>
        </div>
      </SettingsSection>

      {customer && (
        <SettingsSection
          title={b.details}
          description={b.detailsHelp}
          action={
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onPortal()}>
              {b.edit}
            </Button>
          }
        >
          <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-[10rem_1fr]">
            {(
              [
                [b.detailsName, customer.name ? [customer.name] : []],
                [b.detailsEmail, customer.email ? [customer.email] : []],
                [b.detailsAddress, customer.address],
                [b.detailsVat, customer.taxIds],
              ] as const
            )
              .filter(([, value]) => value.length > 0)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="-mt-2 flex flex-col sm:mt-0">
                    {value.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </dd>
                </div>
              ))}
          </dl>
        </SettingsSection>
      )}

      <SettingsSection title={b.invoices} description={b.invoicesHelp}>
        {invoices.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">{b.noInvoices}</p>
        ) : (
          invoices.map((invoice) => {
            const label = b.invoiceStatus[invoice.status as keyof typeof b.invoiceStatus]
            return (
              <div key={invoice.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{day(invoice.date)}</span>
                  {invoice.number && <span className="truncate text-xs text-muted-foreground">{invoice.number}</span>}
                </div>
                {label && (
                  <Badge
                    variant={invoice.status === "paid" ? "secondary" : invoice.status === "open" ? "outline" : "destructive"}
                    className="max-sm:hidden"
                  >
                    {label}
                  </Badge>
                )}
                <span className="w-24 text-right tabular-nums">{money(invoice.amount, invoice.currency)}</span>
                {invoice.pdf ? (
                  <Button size="icon-sm" variant="ghost" asChild>
                    <a href={invoice.pdf} target="_blank" rel="noreferrer" aria-label={b.download} title={b.download}>
                      <Download className="size-4" aria-hidden="true" />
                    </a>
                  </Button>
                ) : invoice.url ? (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={invoice.url} target="_blank" rel="noreferrer">
                      {b.view}
                    </a>
                  </Button>
                ) : (
                  <span className="size-7" />
                )}
              </div>
            )
          })
        )}
      </SettingsSection>
    </>
  )
}
