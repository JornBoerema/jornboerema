import { Hono } from "hono"
import { z } from "zod"
import { getAuth } from "@evido/auth/server"
import { billingConfigured, PAYING_STATUSES, PLAN, PRICE_LOOKUP, stripeClient, TRIAL_DAYS } from "@evido/auth/billing"
import { getDb } from "@evido/db"
import { env } from "../env"
import { languageOf, msg } from "../i18n"
import { forgetPlan } from "../lib/access"
import { report } from "../lib/report"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"

/** What the Stripe plugin's endpoints take and answer, called here on the user's behalf. */
type BillingApi = {
  upgradeSubscription(input: {
    body: {
      plan: string
      annual: boolean
      subscriptionId?: string
      successUrl: string
      cancelUrl: string
      returnUrl: string
      locale: string
      disableRedirect: true
    }
    headers: Headers
  }): Promise<{ url?: string | null }>
  createBillingPortal(input: {
    body: { returnUrl: string; locale: string; disableRedirect: true }
    headers: Headers
  }): Promise<{ url: string }>
}
const billingApi = () => getAuth().api as unknown as BillingApi

type Prices = { currency: string; monthly: number; yearly: number }
let prices: { value: Prices; until: number } | undefined

/** What the plan costs, in cents, as Stripe has it. Asked once in a while, not per visitor. */
async function currentPrices(): Promise<Prices | null> {
  if (prices && prices.until > Date.now()) return prices.value
  const found = await stripeClient().prices.list({ lookup_keys: Object.values(PRICE_LOOKUP), active: true })
  const amount = (key: string) => found.data.find((price) => price.lookup_key === key)?.unit_amount
  const monthly = amount(PRICE_LOOKUP.monthly)
  const yearly = amount(PRICE_LOOKUP.yearly)
  if (!monthly || !yearly) return null
  prices = { value: { currency: found.data[0]?.currency ?? "eur", monthly, yearly }, until: Date.now() + 10 * 60_000 }
  return prices.value
}

/** Only back to our own apps: Stripe sends the browser wherever this says. */
const returnTo = z
  .url()
  .max(2000)
  .refine((url) => env.trustedOrigins.includes(new URL(url).origin))

export const billingRoutes = new Hono<AppEnv>()

billingRoutes.get("/", requireSession, async (c) => {
  if (!billingConfigured()) return c.json({ enabled: false }, 200, noStore)
  const userId = c.get("session").user.id
  try {
    const [rows, amounts] = await Promise.all([
      getDb().subscription.findMany({ where: { referenceId: userId } }),
      currentPrices(),
    ])
    const current = rows.find((row) => PAYING_STATUSES.includes(row.status))
    return c.json(
      {
        enabled: true,
        prices: amounts,
        trialDays: TRIAL_DAYS,
        // One trial per account, whatever came of it.
        trialAvailable: !rows.some((row) => row.trialStart || row.trialEnd || row.status === "trialing"),
        subscription: current
          ? {
              status: current.status,
              interval: current.billingInterval,
              periodEnd: current.periodEnd,
              trialEnd: current.status === "trialing" ? current.trialEnd : null,
              endsAtPeriodEnd: Boolean(current.cancelAtPeriodEnd || current.cancelAt),
            }
          : null,
      },
      200,
      noStore
    )
  } catch (error) {
    report("Billing status failed", error)
    return c.json({ error: msg(c, "billingFailed") }, 502)
  }
})

const checkoutBody = z.object({ annual: z.boolean(), returnTo })

billingRoutes.post("/checkout", requireTrustedOrigin, requireSession, async (c) => {
  const body = checkoutBody.safeParse(await c.req.json().catch(() => null))
  if (!billingConfigured() || !body.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  const user = c.get("session").user
  try {
    // Someone who already pays changes their plan in the portal, not by paying twice.
    const existing = await getDb().subscription.findFirst({
      where: { referenceId: user.id, status: { in: PAYING_STATUSES } },
      select: { id: true },
    })
    if (existing) return c.json({ error: msg(c, "billingAlreadySubscribed") }, 409)
    const { url } = await billingApi().upgradeSubscription({
      body: {
        plan: PLAN,
        annual: body.data.annual,
        successUrl: body.data.returnTo,
        cancelUrl: body.data.returnTo,
        returnUrl: body.data.returnTo,
        locale: languageOf(c),
        disableRedirect: true,
      },
      headers: c.req.raw.headers,
    })
    if (!url) throw new Error("Stripe gave no checkout page")
    forgetPlan(user.id)
    return c.json({ url }, 200, noStore)
  } catch (error) {
    report("Checkout failed", error)
    return c.json({ error: msg(c, "billingFailed") }, 502)
  }
})

billingRoutes.post("/portal", requireTrustedOrigin, requireSession, async (c) => {
  const body = z.object({ returnTo }).safeParse(await c.req.json().catch(() => null))
  if (!billingConfigured() || !body.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const { url } = await billingApi().createBillingPortal({
      body: { returnUrl: body.data.returnTo, locale: languageOf(c), disableRedirect: true },
      headers: c.req.raw.headers,
    })
    forgetPlan(c.get("session").user.id)
    return c.json({ url }, 200, noStore)
  } catch (error) {
    report("Billing portal failed", error)
    return c.json({ error: msg(c, "billingFailed") }, 502)
  }
})
