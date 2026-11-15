import { Hono } from "hono"
import { z } from "zod"
import { getAuth } from "@even/auth/server"
import { billingConfigured, PAYING_STATUSES, PLANS, PRICE_LOOKUP, stripeClient, TRIAL_DAYS, type Stripe } from "@even/auth/billing"
import { getDb } from "@even/db"
import { env } from "../env"
import { languageOf, msg } from "../i18n"
import { forgetPlan } from "../lib/access"
import { ensurePersonalOrganization } from "../todo/workspaces-server"
import { report } from "../lib/report"
import { noStore, requireSession, requireTrustedOrigin, type AppEnv } from "../lib/session"

/** What the Stripe plugin's endpoints take and answer, called here on the user's behalf. */
type BillingApi = {
  upgradeSubscription(input: {
    body: {
      plan: string
      annual: boolean
      referenceId: string
      customerType: "organization"
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
    body: { returnUrl: string; locale: string; referenceId: string; customerType: "organization"; disableRedirect: true }
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

const organizationId = z.uuid().optional()

/**
 * The organization whose billing is asked for, if the user is in it: the one named,
 * or else their personal organization (where a person's own subscription lives).
 */
async function billedOrganization(userId: string, asked: string | undefined) {
  const id = asked ?? (await ensurePersonalOrganization(userId))
  const member = await getDb().member.findUnique({
    where: { organizationId_userId: { organizationId: id, userId } },
    select: {
      role: true,
      organization: {
        select: { id: true, name: true, personal: true, stripeCustomerId: true, _count: { select: { members: true } } },
      },
    },
  })
  if (!member) return null
  return {
    ...member.organization,
    members: member.organization._count.members,
    manages: member.role === "owner" || member.role === "admin",
  }
}

billingRoutes.get("/", requireSession, async (c) => {
  if (!billingConfigured()) return c.json({ enabled: false }, 200, noStore)
  const userId = c.get("session").user.id
  const asked = organizationId.safeParse(c.req.query("organizationId"))
  if (!asked.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const organization = await billedOrganization(userId, asked.data)
    if (!organization) return c.json({ error: msg(c, "noWorkspaceAccess") }, 404)
    const [rows, amounts] = await Promise.all([
      getDb().subscription.findMany({ where: { referenceId: organization.id } }),
      currentPrices(),
    ])
    const current = rows.find((row) => PAYING_STATUSES.includes(row.status))
    return c.json(
      {
        enabled: true,
        organization: {
          id: organization.id,
          name: organization.name,
          personal: organization.personal,
          members: organization.members,
          manages: organization.manages,
        },
        prices: amounts,
        trialDays: TRIAL_DAYS,
        // One trial per account, whatever came of it.
        trialAvailable: !rows.some((row) => row.trialStart || row.trialEnd || row.status === "trialing"),
        subscription: current
          ? {
              status: current.status,
              interval: current.billingInterval,
              seats: current.seats ?? organization.members,
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

const checkoutBody = z.object({ annual: z.boolean(), returnTo, organizationId })

billingRoutes.post("/checkout", requireTrustedOrigin, requireSession, async (c) => {
  const body = checkoutBody.safeParse(await c.req.json().catch(() => null))
  if (!billingConfigured() || !body.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  const user = c.get("session").user
  try {
    const organization = await billedOrganization(user.id, body.data.organizationId)
    if (!organization?.manages) return c.json({ error: msg(c, "billingNotManager") }, 403)
    // An organization that already pays changes its plan in the portal, not by paying twice.
    const existing = await getDb().subscription.findFirst({
      where: { referenceId: organization.id, status: { in: PAYING_STATUSES } },
      select: { id: true },
    })
    if (existing) return c.json({ error: msg(c, "billingAlreadySubscribed") }, 409)
    const { url } = await billingApi().upgradeSubscription({
      body: {
        // Yearly is a plan of its own: a seat price has one interval.
        plan: body.data.annual ? PLANS.yearly : PLANS.monthly,
        annual: false,
        referenceId: organization.id,
        customerType: "organization",
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

/** Where a portal visit goes straight to, instead of the portal's start page. */
const flow = z.enum(["payment_method", "switch", "cancel"]).optional()

/** The subscription that still runs for the organization, as kept here. */
const runningSubscription = (organizationId: string) =>
  getDb().subscription.findFirst({
    where: { referenceId: organizationId, status: { in: PAYING_STATUSES } },
    orderBy: { periodStart: "desc" },
  })

function portalFlow(
  kind: z.infer<typeof flow>,
  subscription: string | null | undefined,
  returnUrl: string
): Stripe.BillingPortal.SessionCreateParams.FlowData | undefined {
  const back = { type: "redirect" as const, redirect: { return_url: returnUrl } }
  if (kind === "payment_method") return { type: "payment_method_update", after_completion: back }
  if (!subscription) return undefined
  if (kind === "switch")
    return { type: "subscription_update", subscription_update: { subscription }, after_completion: back }
  if (kind === "cancel")
    return { type: "subscription_cancel", subscription_cancel: { subscription }, after_completion: back }
  return undefined
}

billingRoutes.post("/portal", requireTrustedOrigin, requireSession, async (c) => {
  const body = z.object({ returnTo, organizationId, flow }).safeParse(await c.req.json().catch(() => null))
  if (!billingConfigured() || !body.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const organization = await billedOrganization(c.get("session").user.id, body.data.organizationId)
    if (!organization?.manages) return c.json({ error: msg(c, "billingNotManager") }, 403)
    forgetPlan(c.get("session").user.id)
    if (body.data.flow && organization.stripeCustomerId) {
      const subscription = await runningSubscription(organization.id)
      const flowData = portalFlow(body.data.flow, subscription?.stripeSubscriptionId, body.data.returnTo)
      if (!flowData) return c.json({ error: msg(c, "invalidRequest") }, 400)
      const session = await stripeClient().billingPortal.sessions.create({
        customer: organization.stripeCustomerId,
        return_url: body.data.returnTo,
        locale: languageOf(c),
        flow_data: flowData,
      })
      return c.json({ url: session.url }, 200, noStore)
    }
    const { url } = await billingApi().createBillingPortal({
      body: {
        returnUrl: body.data.returnTo,
        locale: languageOf(c),
        referenceId: organization.id,
        customerType: "organization",
        disableRedirect: true,
      },
      headers: c.req.raw.headers,
    })
    return c.json({ url }, 200, noStore)
  } catch (error) {
    report("Billing portal failed", error)
    return c.json({ error: msg(c, "billingFailed") }, 502)
  }
})

/** A card, a bank account or Link, as far as the page needs to name it. */
function describePaymentMethod(method: Stripe.PaymentMethod | string | null | undefined) {
  if (!method || typeof method === "string") return null
  if (method.card)
    return {
      type: "card" as const,
      brand: method.card.brand,
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
    }
  if (method.sepa_debit) return { type: "sepa_debit" as const, last4: method.sepa_debit.last4 ?? "" }
  if (method.link) return { type: "link" as const, email: method.link.email ?? "" }
  return { type: method.type }
}

/**
 * What only the people who pay need: how they pay, who the invoice is made out to,
 * what the next one will be and the ones before it. Asked of Stripe each time.
 */
billingRoutes.get("/details", requireSession, async (c) => {
  if (!billingConfigured()) return c.json({ error: msg(c, "invalidRequest") }, 400)
  const asked = organizationId.safeParse(c.req.query("organizationId"))
  if (!asked.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const organization = await billedOrganization(c.get("session").user.id, asked.data)
    if (!organization?.manages) return c.json({ error: msg(c, "billingNotManager") }, 403)
    const customerId = organization.stripeCustomerId
    if (!customerId)
      return c.json({ customer: null, paymentMethod: null, upcoming: null, invoices: [] }, 200, noStore)
    const stripe = stripeClient()
    const running = await runningSubscription(organization.id)
    const [customer, subscription, invoices] = await Promise.all([
      stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method", "tax_ids"] }),
      running?.stripeSubscriptionId
        ? stripe.subscriptions.retrieve(running.stripeSubscriptionId, { expand: ["default_payment_method"] })
        : null,
      stripe.invoices.list({ customer: customerId, limit: 24 }),
    ])
    // A subscription that runs on gets a next invoice; one that ends does not.
    const upcoming =
      subscription && !subscription.cancel_at_period_end && !subscription.cancel_at
        ? await stripe.invoices.createPreview({ customer: customerId, subscription: subscription.id }).catch(() => null)
        : null
    const live = customer.deleted ? null : customer
    const method =
      describePaymentMethod(subscription?.default_payment_method) ??
      describePaymentMethod(live?.invoice_settings.default_payment_method)
    return c.json(
      {
        customer: live && {
          name: live.name ?? null,
          email: live.email ?? null,
          address: live.address
            ? [
                live.address.line1,
                live.address.line2,
                [live.address.postal_code, live.address.city].filter(Boolean).join(" "),
                live.address.country,
              ].filter(Boolean)
            : [],
          taxIds: (live.tax_ids?.data ?? []).map((tax) => tax.value),
        },
        paymentMethod: method,
        upcoming: upcoming && {
          amount: upcoming.total,
          currency: upcoming.currency,
          date: upcoming.next_payment_attempt ?? upcoming.period_end,
        },
        invoices: invoices.data
          .filter((invoice) => invoice.status !== "draft" && invoice.status !== "void")
          .map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            date: invoice.created,
            amount: invoice.total,
            currency: invoice.currency,
            status: invoice.status,
            pdf: invoice.invoice_pdf ?? null,
            url: invoice.hosted_invoice_url ?? null,
          })),
      },
      200,
      noStore
    )
  } catch (error) {
    report("Billing details failed", error)
    return c.json({ error: msg(c, "billingFailed") }, 502)
  }
})

/** Takes back a cancellation while the period still runs: the subscription simply goes on. */
billingRoutes.post("/resume", requireTrustedOrigin, requireSession, async (c) => {
  const body = z.object({ organizationId }).safeParse(await c.req.json().catch(() => null))
  if (!billingConfigured() || !body.success) return c.json({ error: msg(c, "invalidRequest") }, 400)
  try {
    const organization = await billedOrganization(c.get("session").user.id, body.data.organizationId)
    if (!organization?.manages) return c.json({ error: msg(c, "billingNotManager") }, 403)
    const subscription = await runningSubscription(organization.id)
    if (!subscription?.stripeSubscriptionId) return c.json({ error: msg(c, "invalidRequest") }, 400)
    await stripeClient().subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
      ...(subscription.cancelAt && { cancel_at: "" }),
    })
    // The webhook says the same a moment later; the page shows it at once.
    await getDb().subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, cancelAt: null, canceledAt: null },
    })
    forgetPlan(c.get("session").user.id)
    return c.json({ ok: true }, 200, noStore)
  } catch (error) {
    report("Resuming subscription failed", error)
    return c.json({ error: msg(c, "billingFailed") }, 502)
  }
})
