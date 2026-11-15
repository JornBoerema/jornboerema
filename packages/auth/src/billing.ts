import { stripe } from "@better-auth/stripe"
import Stripe from "stripe"
import { getDb, type Tx } from "@even/db"
import { queueEmail } from "@even/email"

/**
 * Even Pro, paid per seat by an organization: one seat for every member. A person's
 * own plan is their personal organization's, with one seat. Its prices live at Stripe
 * under these lookup keys; monthly and yearly are two plans, since a seat price has one interval.
 */
export const PLAN = "pro"
export const PLANS = { monthly: "pro", yearly: "pro-yearly" } as const
export const PRICE_LOOKUP = { monthly: "even_mail_pro_monthly", yearly: "even_mail_pro_yearly" } as const
export const TRIAL_DAYS = 14

/** Subscriptions that give access. `past_due` stays in while Stripe retries the payment. */
export const PAYING_STATUSES = ["active", "trialing", "past_due"]

let client: Stripe | undefined

/** Billing is on once both Stripe secrets are set; without them nothing about it exists. */
export const billingConfigured = () =>
  Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Configureer STRIPE_SECRET_KEY.")
  return (client ??= new Stripe(key))
}

const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)

/** Money leaving again, or about to: the admin hears of it the moment Stripe does. */
const ALERTS: Record<string, string> = {
  "charge.dispute.created": "A customer disputed a payment",
  "radar.early_fraud_warning.created": "Stripe warns a payment may be fraudulent",
  "charge.refunded": "A payment was refunded",
}

let seatPrices: Promise<{ monthly: string; yearly: string }> | undefined

/** The price ids behind the lookup keys, asked of Stripe once: a seat plan needs the id itself. */
export function priceIds() {
  seatPrices ??= stripeClient()
    .prices.list({ lookup_keys: Object.values(PRICE_LOOKUP), active: true })
    .then(({ data }) => {
      const id = (key: string) => {
        const price = data.find((item) => item.lookup_key === key)
        if (!price) throw new Error(`No active Stripe price with lookup key ${key}`)
        return price.id
      }
      return { monthly: id(PRICE_LOOKUP.monthly), yearly: id(PRICE_LOOKUP.yearly) }
    })
    .catch((error) => {
      seatPrices = undefined
      throw error
    })
  return seatPrices
}

/** Whether the user may manage the organization's billing: its owners and admins. */
export async function managesBilling(userId: string, organizationId: string) {
  const member = await getDb().member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  })
  return member?.role === "owner" || member?.role === "admin"
}

/** The Better Auth plugin: Checkout, the customer portal and the webhook at /api/auth/stripe/webhook. */
export function billingPlugin() {
  return stripe({
    stripeClient: stripeClient(),
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    // Most accounts only use the free apps; a customer is made when an organization subscribes.
    createCustomerOnSignUp: false,
    organization: {
      enabled: true,
      // The invoice goes to whoever starts the subscription; they can change it in the portal.
      getCustomerCreateParams: async (_organization, ctx) => {
        const email = (ctx.context.session as { user?: { email?: string } } | null)?.user?.email
        return email ? { email } : {}
      },
    },
    onEvent: async (event) => {
      const what = ALERTS[event.type]
      if (!what) return
      for (const to of adminEmails())
        queueEmail({
          to,
          subject: `Even mailen: ${what.toLowerCase()}`,
          text: `${what}.\n\nEvent ${event.id} (${event.type}). Open it in the Stripe dashboard:\nhttps://dashboard.stripe.com/events/${event.id}`,
        })
    },
    subscription: {
      enabled: true,
      requireEmailVerification: true,
      // Every member is a seat; the plugin counts them at checkout.
      plans: async () => {
        const ids = await priceIds()
        return [
          { name: PLANS.monthly, priceId: ids.monthly, seatPriceId: ids.monthly, freeTrial: { days: TRIAL_DAYS } },
          { name: PLANS.yearly, priceId: ids.yearly, seatPriceId: ids.yearly, freeTrial: { days: TRIAL_DAYS } },
        ]
      },
      authorizeReference: async ({ user, referenceId }) => managesBilling(user.id, referenceId),
      getCheckoutSessionParams: async () => ({
        params: {
          allow_promotion_codes: true,
          // An invoice needs an address, and a business its VAT number for the reverse charge.
          billing_address_collection: "required",
          tax_id_collection: { enabled: true },
          // An organization's customer exists before checkout, and Stripe only collects a
          // tax id when checkout may write the business name and address back onto it.
          customer_update: { name: "auto", address: "auto" },
          // Only once a tax registration exists at Stripe: without one it would collect nothing.
          ...(process.env.STRIPE_AUTOMATIC_TAX === "1" && { automatic_tax: { enabled: true } }),
        },
      }),
    },
  })
}

/** Whether the organization pays for Even Pro right now; its members have a seat in it. */
export async function organizationPays(organizationId: string) {
  const subscription = await getDb().subscription.findFirst({
    where: { referenceId: organizationId, status: { in: PAYING_STATUSES } },
    select: { id: true },
  })
  return Boolean(subscription)
}

/** Whether the organization has a subscription that has not ended. */
export async function hasRunningSubscription(tx: Tx, organizationId: string) {
  const subscription = await tx.subscription.findFirst({
    where: { referenceId: organizationId, status: { in: [...PAYING_STATUSES, "unpaid", "incomplete"] } },
    select: { id: true },
  })
  return Boolean(subscription)
}

/**
 * One seat per member: after someone joins or leaves, the subscription at Stripe
 * follows, with the difference prorated on the next invoice. Members change through
 * this app's own routes, not the organization plugin's, so its hook never runs.
 */
export async function syncSeats(organizationId: string) {
  if (!billingConfigured()) return
  const db = getDb()
  const subscription = await db.subscription.findFirst({
    where: { referenceId: organizationId, status: { in: ["active", "trialing", "past_due"] } },
  })
  if (!subscription?.stripeSubscriptionId) return
  const seats = await db.member.count({ where: { organizationId } })
  if (!seats) return
  const ids = await priceIds()
  const stripeSubscription = await stripeClient().subscriptions.retrieve(subscription.stripeSubscriptionId)
  const item = stripeSubscription.items.data.find((entry) => entry.price.id === ids.monthly || entry.price.id === ids.yearly)
  if (!item || item.quantity === seats) return
  await stripeClient().subscriptions.update(stripeSubscription.id, {
    items: [{ id: item.id, quantity: seats }],
    proration_behavior: "create_prorations",
  })
  await db.subscription.update({ where: { id: subscription.id }, data: { seats } })
}

/** Ends an organization's subscriptions at Stripe at once, and forgets them. */
async function endOrganizationSubscriptions(organizationId: string, stripeCustomerId: string | null) {
  if (billingConfigured() && stripeCustomerId)
    for await (const subscription of stripeClient().subscriptions.list({ customer: stripeCustomerId, status: "all" })) {
      if (["canceled", "incomplete_expired"].includes(subscription.status)) continue
      await stripeClient().subscriptions.cancel(subscription.id)
    }
  await getDb().subscription.deleteMany({ where: { referenceId: organizationId } })
}

/**
 * Before an account is deleted: the organizations that are only theirs (their
 * personal one, and any nobody else joined) go with it, their subscriptions ended
 * at once, so nobody pays for an account that no longer exists. Returns the shared
 * organizations they leave, whose seats drop by one afterwards.
 */
export async function endSubscriptions(user: { id: string }) {
  const db = getDb()
  const memberships = await db.member.findMany({
    where: { userId: user.id },
    select: { organization: { select: { id: true, stripeCustomerId: true, _count: { select: { members: true } } } } },
  })
  const alone = memberships.map((m) => m.organization).filter((organization) => organization._count.members === 1)
  for (const organization of alone) await endOrganizationSubscriptions(organization.id, organization.stripeCustomerId)
  await db.organization.deleteMany({ where: { id: { in: alone.map((organization) => organization.id) } } })
  return memberships.map((m) => m.organization.id).filter((id) => !alone.some((organization) => organization.id === id))
}

/** Stripe's types, for code that reads what the client answers. */
export type { Stripe }
