import { stripe } from "@better-auth/stripe"
import Stripe from "stripe"
import { getDb } from "@evido/db"
import { queueEmail } from "@evido/email"

/** The one paid plan, for Even mailen. Its prices live at Stripe under these lookup keys. */
export const PLAN = "pro"
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

/** The Better Auth plugin: Checkout, the customer portal and the webhook at /api/auth/stripe/webhook. */
export function billingPlugin() {
  return stripe({
    stripeClient: stripeClient(),
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    // Most accounts only use the free apps; a customer is made when someone subscribes.
    createCustomerOnSignUp: false,
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
      plans: [
        {
          name: PLAN,
          lookupKey: PRICE_LOOKUP.monthly,
          annualDiscountLookupKey: PRICE_LOOKUP.yearly,
          freeTrial: { days: TRIAL_DAYS },
        },
      ],
      getCheckoutSessionParams: async () => ({
        params: {
          allow_promotion_codes: true,
          // An invoice needs an address, and a business its VAT number for the reverse charge.
          billing_address_collection: "required",
          tax_id_collection: { enabled: true },
          // Only once a tax registration exists at Stripe: without one it would collect nothing.
          ...(process.env.STRIPE_AUTOMATIC_TAX === "1" && { automatic_tax: { enabled: true } }),
        },
      }),
    },
  })
}

/** Whether the user has a subscription that gives access right now. */
export async function hasPaidPlan(userId: string) {
  const subscription = await getDb().subscription.findFirst({
    where: { referenceId: userId, status: { in: PAYING_STATUSES } },
    select: { id: true },
  })
  return Boolean(subscription)
}

/**
 * Before an account is deleted: its subscriptions end at once, so nobody pays
 * for an account that no longer exists.
 */
export async function endSubscriptions(user: { id: string; stripeCustomerId?: string | null }) {
  if (billingConfigured() && user.stripeCustomerId)
    for await (const subscription of stripeClient().subscriptions.list({ customer: user.stripeCustomerId, status: "all" })) {
      if (["canceled", "incomplete_expired"].includes(subscription.status)) continue
      await stripeClient().subscriptions.cancel(subscription.id)
    }
  await getDb().subscription.deleteMany({ where: { referenceId: user.id } })
}
