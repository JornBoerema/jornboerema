// Safe to import from browsers: no Node APIs here.
//
// Track & trace in shipping mail: which carrier, the tracking code and link,
// and how far the parcel is, as the mail says. Nothing is looked up online.

export const CARRIERS = ["postnl", "dhl", "dpd", "gls", "ups", "budbee", "trunkrs", "dragonfly", "amazon"] as const
export type Carrier = (typeof CARRIERS)[number]

/** Furthest along wins when a mail mentions several. */
export const SHIPMENT_STATUSES = [
  "announced",
  "in_transit",
  "out_for_delivery",
  "pickup",
  "delivered",
  "problem",
] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

export type FoundShipment = {
  carrier: Carrier | null
  trackingCode: string | null
  trackingUrl: string | null
  /** The shop it comes from, when the mail says. */
  merchant: string | null
  /** The shop's order number, which ties a shop's mail to the carrier's. */
  orderNumber: string | null
  status: ShipmentStatus | null
}

type Mail = { subject: string; fromName: string | null; fromEmail: string | null; html: string | null; text: string | null }

/** Senders and tracking sites, by the carrier they belong to. */
const CARRIER_DOMAINS: Record<Carrier, RegExp> = {
  postnl: /(^|\.)postnl\.(nl|com|be|post)$/,
  dhl: /(^|\.)(dhl\.[a-z.]+|dhlparcel\.[a-z]+|dhlecommerce\.[a-z]+)$/,
  dpd: /(^|\.)(dpd\.[a-z.]+|dpdgroup\.com)$/,
  gls: /(^|\.)(gls-[a-z-]+\.[a-z]+|gls\.[a-z]+)$/,
  ups: /(^|\.)ups\.com$/,
  budbee: /(^|\.)budbee\.com$/,
  trunkrs: /(^|\.)trunkrs\.(nl|com)$/,
  // Delivers Amazon's parcels in the Netherlands.
  dragonfly: /(^|\.)dragonflyinternational\.com$/,
  amazon: /(^|\.)amazon\.[a-z.]+$/,
}

/** Which carrier owns a domain, if any. */
export function carrierOfDomain(domain: string): Carrier | null {
  const host = domain.toLowerCase().replace(/\.$/, "")
  return CARRIERS.find((carrier) => CARRIER_DOMAINS[carrier].test(host)) ?? null
}

const domainOf = (email: string | null) => (email?.split("@")[1] ?? "").toLowerCase()

/** Subjects of shipping mail, from carriers and shops alike, in Dutch, English and German. */
const SHIPPING_SUBJECT =
  /pakket|pakje|zending|bezorg|verzonden|verstuurd|onderweg|afhaalpunt|track\s*(&|en|and)?\s*trace|parcel|package|shipment|shipped|shipping|on its way|out for delivery|delivered|delivery|paket|sendung|zugestellt|versandt|unterwegs/i

/**
 * From the list alone (sender and subject): might this be shipping mail? Cheap,
 * so only these are read to look for a tracking link.
 */
export function looksLikeShipment({ fromEmail, subject }: { fromEmail: string | null; subject: string }) {
  const carrier = carrierOfDomain(domainOf(fromEmail))
  // Amazon also mails about everything else; only its delivery mail counts.
  if (carrier && carrier !== "amazon") return true
  return SHIPPING_SUBJECT.test(subject)
}

/** Tracking codes as each carrier prints them. */
const CODE_PATTERNS: [Carrier, RegExp][] = [
  ["postnl", /\b3S[A-Z0-9]{11,15}\b/],
  ["postnl", /\b[A-Z]{2}\d{9}NL\b/],
  ["dhl", /\bJVGL\d{14,22}\b/],
  ["dhl", /\bJJD\d{10,20}\b/],
  ["ups", /\b1Z[A-Z0-9]{16}\b/],
  ["dragonfly", /\bAMZNL\d{9,14}\b/],
]

/** A link whose text is the code itself, as some carriers and shops print it. */
const LABEL_IS_CODE = /^(?=[A-Z0-9-]*\d)[A-Z0-9-]{8,30}$/

/** The query parameters carriers put the tracking code in. */
const CODE_PARAMS = ["b", "tc", "tracking-id", "trackingnumber", "tracknum", "parcelnumber", "parcelno", "match", "barcode", "code", "id"]

/** Words a tracking link's text or a code's neighbourhood use. */
const TRACKING_WORDS = /track|volg|trace|zending|pakket|parcel|package|sendung|paket|status|bezorg/i

/** A mail's links with their visible text, in order. */
function linksIn(html: string): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = []
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[2]).trim()
    if (!/^https?:\/\//i.test(href)) continue
    links.push({ href, label: decodeEntities(match[3].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() })
  }
  return links
}

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")

function parseUrl(href: string) {
  try {
    return new URL(href)
  } catch {
    return null
  }
}

/** A tracking code in a carrier's link, when the link names one. */
function codeInUrl(url: URL): string | null {
  for (const [name, value] of url.searchParams) {
    if (CODE_PARAMS.includes(name.toLowerCase()) && /^[A-Z0-9-]{8,30}$/i.test(value)) return value.toUpperCase()
  }
  // jouw.postnl.nl/track-and-trace/3SABC1234567890-NL-1234AB and the like.
  const inPath = url.pathname.match(/\/(3S[A-Z0-9]{11,15}|JVGL\d{14,22}|1Z[A-Z0-9]{16}|0\d{13})(?=[-/]|$)/i)
  return inPath ? inPath[1].toUpperCase() : null
}

/** What a link to the parcel's status says, wherever it points. */
const WRAPPED_LABEL =
  /track|\bvolg\b|follow|waar is (mijn|je) pakket|bezorginformatie|bezorgstatus|bezorgmoment|status (van|bekijken)|sendung verfolgen|where is my|bekijk (je|de|mijn) (zending|status|pakket)/i

/** The link to follow the parcel, preferring a carrier's own site over a shop's wrapped one. */
function trackingLink(links: { href: string; label: string }[]) {
  let wrapped: { url: URL; carrier: Carrier | null; code?: string } | null = null
  for (const { href, label } of links) {
    const url = parseUrl(href)
    if (!url) continue
    const carrier = carrierOfDomain(url.hostname)
    const tracking = TRACKING_WORDS.test(url.pathname + url.search) || TRACKING_WORDS.test(label)
    if (carrier && carrier !== "amazon" && tracking) return { url, carrier }
    if (carrier === "amazon" && /track|progress|ship-track/i.test(url.pathname + url.search)) return { url, carrier }
    // A shop's or carrier's click-tracking link that says it follows the parcel,
    // or whose text is the tracking code.
    if (!wrapped && LABEL_IS_CODE.test(label)) wrapped = { url, carrier: null, code: label }
    else if (!wrapped && WRAPPED_LABEL.test(label)) wrapped = { url, carrier: null }
  }
  return wrapped
}

/** A carrier's public tracking page for a code, when the mail had no direct link. */
export function trackingUrlFor(carrier: Carrier, code: string): string | null {
  const id = encodeURIComponent(code)
  switch (carrier) {
    case "postnl":
      return `https://jouw.postnl.nl/track-and-trace/${id}`
    case "dhl":
      return `https://www.dhl.com/nl-nl/home/tracking/tracking-parcel.html?submit=1&tracking-id=${id}`
    case "dpd":
      return `https://tracking.dpd.de/status/nl_NL/parcel/${id}`
    case "gls":
      return `https://gls-group.com/NL/nl/pakket-volgen?match=${id}`
    case "ups":
      return `https://www.ups.com/track?tracknum=${id}`
    default:
      return null
  }
}

/** A printed tracking code near words about tracking. */
function codeInText(text: string): { carrier: Carrier; code: string } | null {
  for (const [carrier, pattern] of CODE_PATTERNS) {
    const match = text.match(pattern)
    if (match) return { carrier, code: match[0] }
  }
  // DPD's fourteen digits only count right after a word about the parcel.
  const dpd = text.match(/(?:track|zending|pakket|parcel|paket|sendung|nummer|number)[^\d\n]{0,30}(0\d{13})\b/i)
  return dpd ? { carrier: "dpd", code: dpd[1] } : null
}

/**
 * Where the parcel is, as the subject (and else the mail's opening) says.
 * Checked from the most decisive: a problem or delivery outweighs "on its way".
 */
const STATUS_PATTERNS: [ShipmentStatus, RegExp][] = [
  [
    "problem",
    /niet (be)?zorg(d|en)|niet (kunnen )?afgeleverd|bezorging (is )?mislukt|kon(den)? niet bezorg|vertraagd|vertraging|could not be delivered|delivery (attempt )?failed|delayed|missed delivery|nicht zugestellt|verzögert/i,
  ],
  [
    "pickup",
    /ligt (klaar )?(voor je )?(klaar|bij)|af te halen|ophalen bij|afhaalpunt|servicepunt|pakketpunt|ready (for|to) (be )?pick|pick ?up point|abholbereit|abholen/i,
  ],
  [
    "delivered",
    /\b(is|zijn|werd|werden) (vandaag )?(be)?zorgd\b|\b(is|zijn) afgeleverd|\bbezorgd!|\bafgeleverd\b|has been delivered|was delivered|\bdelivered\b(?! (today|tomorrow|between|on))|\bzugestellt\b/i,
  ],
  [
    "out_for_delivery",
    /onderweg voor bezorging|we bezorgen je pakket vandaag|wordt vandaag (be)?zorgd|vandaag (tussen|bezorgd|bij je)|komt vandaag|onderweg naar (jou|je|u)\b|bezorger is onderweg|out for delivery|arriving today|delivered today|heute zugestellt|in zustellung/i,
  ],
  [
    "in_transit",
    /onderweg|verzonden|verstuurd|is nu bij|aangekomen in|hebben je pakket ontvangen|in transit|shipped|on (its|the) way|has (been )?(dispatched|sent)|sorteercentrum|versandt|unterwegs|ist auf dem weg/i,
  ],
  ["announced", /aangemeld|verwacht|bezorgmoment|bezorgdatum|wordt verzonden|label|announced|expected|arrives?|zustellung (erwartet|angekündigt)/i],
]

export function statusOf(subject: string, opening: string): ShipmentStatus | null {
  for (const text of [subject, opening]) {
    for (const [status, pattern] of STATUS_PATTERNS) if (pattern.test(text)) return status
  }
  return null
}

/** Something that looks like a reference: letters and digits, with at least one digit. */
const REFERENCE = "(?=[A-Z0-9-]*\\d)[A-Z0-9][A-Z0-9-]{4,24}"

/** The order number a shop gives: "Bestelling: [C000JNHN6X]", "referentie #LOTJE175909", JSON-LD. */
export function orderNumberIn(subject: string, raw: string): string | null {
  const patterns = [
    new RegExp(`"orderNumber"\\s*:\\s*"(${REFERENCE})"`, "i"),
    // In a link to the order: bol's order_details/C000JNHN6X, ?orderId=...
    new RegExp(`(?:order[_-]?details|orders?)/(${REFERENCE})(?=[/?"'&#]|$)`, "i"),
    new RegExp(`[?&](?:order[_-]?(?:id|number|nr))=(${REFERENCE})\\b`, "i"),
    new RegExp(`(?:bestel(?:ling|nummer)?|order(?:nummer|number|nr\\.?| no\\.?)?|referentie|reference|bestelnr\\.?)\\s*(?:met referentie\\s*)?[:#]?\\s*\\[?#?(${REFERENCE})\\b`, "i"),
  ]
  for (const text of [subject, raw]) {
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) return match[1].toUpperCase()
    }
  }
  return null
}

/** A tracking code a mail spells out: "track en trace code: 420986074", JSON-LD's trackingNumber. */
function spelledOutCode(raw: string): string | null {
  const match =
    raw.match(new RegExp(`"trackingNumber"\\s*:\\s*"(${REFERENCE})"`, "i")) ??
    raw.match(
      new RegExp(
        `(?:track(?:\\s*(?:&|en|and)\\s*trace)?|tracking|barcode|zending)[ -]?(?:code|nummer|number|nr)\\s*[:#]?\\s*(${REFERENCE})\\b`,
        "i"
      )
    )
  return match ? match[1].toUpperCase() : null
}

/** Order numbers some shops print without saying so, by their fixed shape. */
const SHOP_ORDERS: [RegExp, RegExp][] = [[/(^|\.)bol\.com$/, /\bC0{2,}[A-Z0-9]{5,8}\b/]]

function shopOrderNumber(domain: string, raw: string) {
  for (const [shop, shape] of SHOP_ORDERS) if (shop.test(domain)) return raw.match(shape)?.[0] ?? null
  return null
}

/** "Lotgenootje via GoParcel" is Lotgenootje's parcel, sent through GoParcel. */
const shopName = (name: string | null) => name?.replace(/\s+via\s+.+$/i, "").trim() || null

/** "Je pakket van Coolblue", "your parcel from Zalando". */
function merchantIn(text: string) {
  const match = text.match(
    /(?:pakket(?:je)?|zending|bestelling|parcel|package|order|paket|sendung)\s+(?:van|from|von)\s+([A-Z0-9][\w&.' -]{1,38}?)(?=\s+(?:is|wordt|komt|has|was|ist|wird)\b|[.,!:\n(]|$)/
  )
  return match ? match[1].trim() : null
}

const plainText = (mail: Mail) =>
  (mail.text?.trim() || (mail.html ?? "").replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")

/** How far into a mail its status is still part of the message, not the footer. */
const OPENING = 700

/**
 * The shipment a mail is about, or null when it names no carrier, code or
 * tracking link: an order confirmation without one isn't followable yet.
 */
export function findShipment(mail: Mail): FoundShipment | null {
  const text = plainText(mail)
  const senderCarrier = carrierOfDomain(domainOf(mail.fromEmail))
  const link = trackingLink(linksIn(mail.html ?? ""))
  const printed = codeInText(`${mail.subject}\n${text.slice(0, 20_000)}`)
  const linkCode = link ? (link.carrier ? codeInUrl(link.url) : (link.code ?? null)) : null
  // Trunkrs and others put the code in the subject: "[420986074] Je pakket ...".
  const subjectCode = senderCarrier ? (mail.subject.match(/^\s*\[(\d{6,})\]/)?.[1] ?? null) : null
  // Amazon's own mail names the order, which ties its mails about one parcel together.
  const amazonOrder = senderCarrier === "amazon" ? (`${mail.subject} ${text}`.match(/\b\d{3}-\d{7}-\d{7}\b/)?.[0] ?? null) : null

  const carrier = link?.carrier ?? printed?.carrier ?? senderCarrier
  const raw = `${mail.html ?? ""}\n${text}`.slice(0, 60_000)
  const trackingCode = linkCode ?? printed?.code ?? subjectCode ?? spelledOutCode(raw) ?? amazonOrder
  const trackingUrl = link?.url.toString() ?? (carrier && trackingCode ? trackingUrlFor(carrier, trackingCode) : null)
  if (!trackingUrl && !trackingCode) return null
  // A code alone is only followable from a carrier's own mail.
  if (!trackingUrl && !carrier) return null
  // Amazon mails about much more than parcels; without a tracking link it isn't one.
  if (carrier === "amazon" && !link) return null

  const fromCarrier = senderCarrier !== null
  const merchant = shopName(fromCarrier ? merchantIn(`${mail.subject}\n${text.slice(0, OPENING)}`) : mail.fromName)
  return {
    carrier,
    trackingCode,
    trackingUrl,
    merchant,
    orderNumber: amazonOrder ?? orderNumberIn(mail.subject, raw) ?? shopOrderNumber(domainOf(mail.fromEmail), raw),
    status: statusOf(mail.subject, text.slice(0, OPENING)),
  }
}

/**
 * One shipment from a conversation's messages, oldest first: the newest
 * message decides the status, any of them may hold the link and code.
 */
export function findShipmentInThread(messages: Mail[]): FoundShipment | null {
  let found = null as FoundShipment | null
  for (const message of messages) {
    const shipment = findShipment(message)
    if (!shipment) continue
    found = {
      carrier: shipment.carrier ?? found?.carrier ?? null,
      trackingCode: shipment.trackingCode ?? found?.trackingCode ?? null,
      trackingUrl: shipment.trackingUrl ?? found?.trackingUrl ?? null,
      merchant: shipment.merchant ?? found?.merchant ?? null,
      orderNumber: shipment.orderNumber ?? found?.orderNumber ?? null,
      status: shipment.status ?? found?.status ?? null,
    }
  }
  return found
}
