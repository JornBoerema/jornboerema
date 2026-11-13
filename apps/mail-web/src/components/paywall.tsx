import { isDesktop, webUrl } from "@evido/auth/client"
import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@evido/ui/components/empty"
import { cn } from "@evido/ui/lib/utils"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { signOut } from "@/lib/auth-client"

type Billing = {
  enabled: boolean
  prices?: { currency: string; monthly: number; yearly: number } | null
  trialDays?: number
  trialAvailable?: boolean
}

/**
 * Even mailen takes a subscription. Shown to signed-in users without one: what
 * it costs, and the way to Stripe's checkout, which sends them back here.
 */
export function Paywall({ email }: { email: string }) {
  const { t: all, locale } = useI18n()
  const t = all.paywall
  const [annual, setAnnual] = useState(true)
  const billing = useQuery({ queryKey: ["billing"], queryFn: () => api<Billing>("/api/billing") })
  const checkout = useMutation({
    mutationFn: async () => {
      // Checkout comes back with a cookie session, which the desktop app doesn't have.
      if (isDesktop()) return { url: webUrl("/", "mail"), external: true }
      return api<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annual, returnTo: window.location.origin + "/" }),
      })
    },
    onSuccess: ({ url, external }: { url: string; external?: boolean }) =>
      external ? window.open(url, "_blank") : window.location.assign(url),
    onError: (error) => toast.error(errorText(error)),
  })

  const prices = billing.data?.prices
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: prices?.currency ?? "eur",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100)
  const trial = billing.data?.trialAvailable ? (billing.data.trialDays ?? 0) : 0
  const options = prices
    ? [
        { annual: true, label: t.yearly, price: t.perMonth(money(Math.round(prices.yearly / 12))), note: t.billedYearly(money(prices.yearly)) },
        { annual: false, label: t.monthly, price: t.perMonth(money(prices.monthly)), note: t.billedMonthly },
      ]
    : []

  return (
    <div className="auth-layout">
      <header>
        <Brand />
      </header>
      <main className="auth-main">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Mail01Icon} strokeWidth={1.75} />
            </EmptyMedia>
            <EmptyTitle>{t.title}</EmptyTitle>
            <EmptyDescription>{trial ? t.bodyTrial(trial) : t.body}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {options.length > 0 && (
              <div role="radiogroup" aria-label={t.choose} className="grid w-full grid-cols-2 gap-2">
                {options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    role="radio"
                    aria-checked={annual === option.annual}
                    onClick={() => setAnnual(option.annual)}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      annual === option.annual ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    )}
                  >
                    <span className="text-xs text-muted-foreground">{option.label}</span>
                    <span className="text-sm font-medium text-foreground">{option.price}</span>
                    <span className="text-xs text-muted-foreground">{option.note}</span>
                  </button>
                ))}
              </div>
            )}
            <Button disabled={checkout.isPending || billing.isPending} onClick={() => checkout.mutate()}>
              {trial ? t.startTrial(trial) : t.subscribe}
            </Button>
            <p className="text-xs text-muted-foreground">{trial ? t.finePrintTrial : t.finePrint}</p>
            <p className="text-xs text-muted-foreground">
              {t.signedInAs(email)}{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => void signOut()}>
                {t.signOut}
              </button>
            </p>
          </EmptyContent>
        </Empty>
      </main>
    </div>
  )
}
