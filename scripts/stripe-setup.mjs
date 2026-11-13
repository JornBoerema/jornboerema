// Sets Stripe up for Even mailen: the product, its two prices, the customer
// portal and (with --webhook <url>) the webhook endpoint. Safe to run again: it
// only makes what is missing. Run it once per Stripe account, sandbox and live:
//
//   STRIPE_SECRET_KEY=sk_… node scripts/stripe-setup.mjs [--webhook https://api.jornboerema.nl/api/auth/stripe/webhook]
//
// Prices are found by lookup key, so the app needs no ids from this script.

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error("Set STRIPE_SECRET_KEY.")
  process.exit(1)
}

const PRODUCT = { id: "even_mail_pro", name: "Even mailen Pro" }
// Euro cents, VAT included: what a consumer sees is what they pay.
const PRICES = [
  { lookupKey: "even_mail_pro_monthly", amount: 1500, interval: "month", nickname: "Monthly" },
  { lookupKey: "even_mail_pro_yearly", amount: 14400, interval: "year", nickname: "Yearly" },
]
const SITE = "https://jornboerema.nl"
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.dispute.created",
  "charge.refunded",
  "radar.early_fraud_warning.created",
]

/** Stripe takes form fields; nested values become name[child]=value. */
function form(value, prefix = "", out = new URLSearchParams()) {
  for (const [name, item] of Object.entries(value)) {
    const field = prefix ? `${prefix}[${name}]` : name
    if (item !== null && typeof item === "object") form(item, field, out)
    else if (item !== undefined) out.append(field, String(item))
  }
  return out
}

async function stripe(method, path, body) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? form(body) : undefined,
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data.error?.message ?? `Stripe answered ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

const account = await stripe("GET", "account")
const live = key.startsWith("sk_live") || key.startsWith("rk_live")
console.log(`Account ${account.id} (${account.settings?.dashboard?.display_name ?? "?"}), ${live ? "LIVE" : "sandbox"}`)

// Product
let product
try {
  product = await stripe("GET", `products/${PRODUCT.id}`)
  console.log(`Product ${product.id} exists`)
} catch (error) {
  if (error.status !== 404) throw error
  product = await stripe("POST", "products", {
    ...PRODUCT,
    description: "Fast mail for Gmail and Outlook, with AI summaries, replies and writing.",
    // Software as a service, business use.
    tax_code: "txcd_10103001",
    url: SITE,
  })
  console.log(`Product ${product.id} created`)
}

// Prices: a price can't change its amount, so a new one takes over the lookup key.
const prices = {}
for (const wanted of PRICES) {
  const found = await stripe("GET", `prices?lookup_keys[]=${wanted.lookupKey}&active=true`)
  const current = found.data[0]
  const same =
    current &&
    current.unit_amount === wanted.amount &&
    current.currency === "eur" &&
    current.recurring?.interval === wanted.interval &&
    current.product === product.id
  if (same) {
    prices[wanted.lookupKey] = current.id
    console.log(`Price ${wanted.lookupKey} exists (${current.id})`)
    continue
  }
  const created = await stripe("POST", "prices", {
    product: product.id,
    currency: "eur",
    unit_amount: wanted.amount,
    recurring: { interval: wanted.interval },
    tax_behavior: "inclusive",
    nickname: wanted.nickname,
    lookup_key: wanted.lookupKey,
    transfer_lookup_key: true,
  })
  if (current) await stripe("POST", `prices/${current.id}`, { active: false })
  prices[wanted.lookupKey] = created.id
  console.log(`Price ${wanted.lookupKey} created (${created.id})`)
}

// Customer portal: where a customer changes card, switches between monthly and yearly, or cancels.
const portal = {
  business_profile: { headline: "Even mailen", privacy_policy_url: `${SITE}/privacy`, terms_of_service_url: `${SITE}/terms` },
  features: {
    customer_update: { enabled: true, allowed_updates: { 0: "email", 1: "name", 2: "address", 3: "tax_id" } },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      cancellation_reason: {
        enabled: true,
        options: { 0: "too_expensive", 1: "missing_features", 2: "switched_service", 3: "unused", 4: "other" },
      },
    },
    subscription_update: {
      enabled: true,
      default_allowed_updates: { 0: "price" },
      proration_behavior: "create_prorations",
      products: { 0: { product: product.id, prices: Object.fromEntries(Object.values(prices).map((id, index) => [index, id])) } },
    },
  },
}
const configurations = await stripe("GET", "billing_portal/configurations?limit=100")
const existing = configurations.data.find((item) => item.is_default) ?? configurations.data.find((item) => item.metadata?.app === "even-mail")
if (existing) {
  await stripe("POST", `billing_portal/configurations/${existing.id}`, portal)
  console.log(`Customer portal updated (${existing.id}${existing.is_default ? ", default" : ""})`)
} else {
  const created = await stripe("POST", "billing_portal/configurations", { ...portal, metadata: { app: "even-mail" } })
  console.log(`Customer portal created (${created.id}${created.is_default ? ", default" : ", NOT default: save the portal settings once in the dashboard"})`)
}

// Webhook
const at = process.argv.indexOf("--webhook")
const url = at > -1 ? process.argv[at + 1] : null
if (url) {
  const endpoints = await stripe("GET", "webhook_endpoints?limit=100")
  const endpoint = endpoints.data.find((item) => item.url === url)
  const events = Object.fromEntries(WEBHOOK_EVENTS.map((event, index) => [index, event]))
  if (endpoint) {
    await stripe("POST", `webhook_endpoints/${endpoint.id}`, { enabled_events: events })
    console.log(`Webhook ${endpoint.id} exists; its events were brought up to date. Its secret is only shown when it is made.`)
  } else {
    const created = await stripe("POST", "webhook_endpoints", { url, enabled_events: events, description: "Even mailen subscriptions" })
    console.log(`Webhook ${created.id} created. Set this as STRIPE_WEBHOOK_SECRET where the API runs:`)
    console.log(created.secret)
  }
}

const tax = await stripe("GET", "tax/registrations?status=active&limit=1").catch(() => ({ data: [] }))
console.log(
  tax.data.length
    ? "Stripe Tax has a registration: set STRIPE_AUTOMATIC_TAX=1 to have VAT worked out per country."
    : "Stripe Tax has no registration yet, so VAT is not worked out per country. Add one under Tax > Registrations, then set STRIPE_AUTOMATIC_TAX=1."
)
