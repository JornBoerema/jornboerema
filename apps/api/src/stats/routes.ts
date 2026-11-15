import { createHmac, randomUUID } from "node:crypto"
import { Hono } from "hono"
import { getDb } from "@even/db"
import { env } from "../env"

/**
 * Page views for the admin's visitor statistics, sent by jornboerema.nl and the
 * web app with navigator.sendBeacon. No cookies and no IP addresses are kept:
 * the visitor is a hash of IP and browser with a salt that changes every day.
 */
export const statsRoutes = new Hono()

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python|node-fetch|axios|vercel/i

export function device(ua: string) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet"
  if (/mobi|iphone|android/i.test(ua)) return "mobile"
  return "desktop"
}

export function browser(ua: string) {
  if (/edg\//i.test(ua)) return "Edge"
  if (/opr\/|opera/i.test(ua)) return "Opera"
  if (/firefox|fxios/i.test(ua)) return "Firefox"
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet"
  if (/chrome|crios|chromium/i.test(ua)) return "Chrome"
  if (/safari/i.test(ua)) return "Safari"
  return "Other"
}

export function os(ua: string) {
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS"
  if (/android/i.test(ua)) return "Android"
  if (/mac os x|macintosh/i.test(ua)) return "macOS"
  if (/windows/i.test(ua)) return "Windows"
  if (/cros/i.test(ua)) return "ChromeOS"
  if (/linux/i.test(ua)) return "Linux"
  return "Other"
}

/** App paths carry ids (/todo/list/abc): only the section is kept, and the admin isn't counted. */
export function cleanPath(site: string, raw: string) {
  const path = (raw.split(/[?#]/)[0] || "/").slice(0, 200)
  if (site === "home") return path.length > 1 ? path.replace(/\/+$/, "") : "/"
  const [, first = "", second = ""] = path.split("/")
  if (!first) return "/"
  if (first === "admin") return null
  if ((first === "todo" || first === "notes") && ["shared", "invite"].includes(second)) return `/${first}/${second}`
  return `/${first}`
}

const SITES = () => ({
  home: env.homeWebUrl,
  app: env.appWebUrl,
})

function siteOf(origin: string | undefined) {
  if (!origin) return null
  for (const [site, url] of Object.entries(SITES())) if (new URL(url).origin === origin) return site
  // While developing, any localhost page counts as the site it says it is.
  return /^http:\/\/localhost:\d+$/.test(origin) && !env.apiUrl.startsWith("https://") ? "dev" : null
}

const salt = (day: string) => createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "even").update(`visitors:${day}`).digest()

type Hit = { site?: unknown; path?: unknown; referrer?: unknown; source?: unknown }

statsRoutes.post("/hit", async (c) => {
  const ua = c.req.header("user-agent") ?? ""
  const allowed = siteOf(c.req.header("origin"))
  if (!allowed || !ua || BOT.test(ua) || c.req.header("purpose") === "prefetch") return c.body(null, 204)
  // sendBeacon posts text/plain, which needs no preflight.
  const hit = ((await c.req.json().catch(() => null)) ?? {}) as Hit
  const site = allowed === "dev" ? (hit.site === "home" ? "home" : "app") : allowed
  const path = cleanPath(site, typeof hit.path === "string" ? hit.path : "/")
  if (!path) return c.body(null, 204)
  let referrer: string | null = null
  try {
    if (typeof hit.referrer === "string" && hit.referrer) {
      const host = new URL(hit.referrer).hostname.replace(/^www\./, "")
      // Moving between our own pages isn't a referral.
      if (!/(^|\.)jornboerema\.nl$|^localhost$/.test(host)) referrer = host.slice(0, 120)
    }
  } catch {}
  const source = typeof hit.source === "string" && hit.source ? hit.source.slice(0, 60).toLowerCase() : null
  const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() || c.req.header("x-real-ip") || ""
  const day = new Date().toISOString().slice(0, 10)
  const visitor = createHmac("sha256", salt(day)).update(`${ip}|${ua}`).digest("base64url").slice(0, 22)
  const country = c.req.header("x-vercel-ip-country")?.slice(0, 2).toUpperCase() || null
  await getDb()
    .pageView.create({
      data: { id: randomUUID(), site, path, referrer, source, country, device: device(ua), browser: browser(ua), os: os(ua), visitor },
    })
    .catch((error) => console.error("[stats] hit", error))
  return c.body(null, 204)
})
