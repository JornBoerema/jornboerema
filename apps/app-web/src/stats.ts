import { API_URL } from "@/account/lib/api"

/**
 * Counts page views for the admin's visitor statistics, without cookies (see
 * jornboerema.nl/privacy). Once per load and whenever the section changes
 * (/mail → /todo); the API keeps only the section, never ids. Not the admin.
 */
export function countPageViews() {
  if (navigator.webdriver) return
  let last = ""
  let referrer = document.referrer
  const send = () => {
    const [, section = ""] = window.location.pathname.split("/")
    if (section === "admin") return
    const path = window.location.pathname
    const key = /^(todo|notes)$/.test(section) ? path.split("/").slice(0, 3).join("/") : section
    if (key === last) return
    last = key
    const params = new URLSearchParams(window.location.search)
    const body = JSON.stringify({ site: "app", path, referrer, source: params.get("utm_source") ?? "" })
    referrer = ""
    try {
      if (!navigator.sendBeacon?.(`${API_URL}/api/stats/hit`, body))
        void fetch(`${API_URL}/api/stats/hit`, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {})
    } catch {}
  }
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history)
    history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args)
      send()
    }
  }
  window.addEventListener("popstate", send)
  send()
}
