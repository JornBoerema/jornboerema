import { DAYS, MONITORS, type Day, type StatusData } from "./monitors.ts"

/** The page draws /api/status and refreshes it every minute, as often as the checks run. */

const REFRESH_MS = 60_000
/** No check for this long means the monitor itself stopped, not that all is well. */
const STALE_MS = 5 * 60_000

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const nameOf = (id: string) => MONITORS.find((m) => m.id === id)?.name ?? id

const time = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })
const dayLong = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })
const dateTime = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
})

function percent(share: number) {
  if (share >= 0.99995) return "100%"
  return `${(Math.floor(share * 10000) / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2 })}%`
}

function lasted(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} u ${minutes % 60} min` : `${hours} u`
}

function level(day: Day) {
  if (!day.total) return "none"
  if (day.ok === day.total) return "good"
  return day.ok / day.total >= 0.99 ? "some" : "bad"
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { data?: Record<string, string> } = {}, ...children: (Node | string)[]) {
  const { data, ...rest } = props
  const node = Object.assign(document.createElement(tag), rest)
  for (const [key, value] of Object.entries(data ?? {})) node.dataset[key] = value
  node.append(...children)
  return node
}

function banner(data: StatusData) {
  const banner = $("banner")
  const headline = $("headline")
  const checked = $("checked")
  const stale = !data.lastCheckAt || Date.now() - Date.parse(data.lastCheckAt) > STALE_MS
  const down = data.monitors.filter((m) => m.up === false)

  if (stale) {
    banner.dataset.state = "stale"
    headline.textContent = "De controle zelf staat stil"
    checked.textContent = data.lastCheckAt
      ? `Laatste controle om ${time.format(new Date(data.lastCheckAt))}. Wat hieronder staat kan verouderd zijn.`
      : "Er zijn nog geen controles gedaan."
    return
  }
  checked.textContent = `Laatst gecontroleerd om ${time.format(new Date(data.lastCheckAt!))}`
  if (!down.length) {
    banner.dataset.state = "up"
    headline.textContent = "Alles werkt"
  } else if (down.length === data.monitors.length) {
    banner.dataset.state = "down"
    headline.textContent = "Even is onbereikbaar"
  } else {
    banner.dataset.state = "partial"
    headline.textContent = `Storing bij ${down.map((m) => nameOf(m.id).replace("Even ", "de ")).join(" en ")}`
  }
}

function monitors(data: StatusData) {
  const list = $("monitors")
  list.replaceChildren(
    ...data.monitors.map((monitor) => {
      const meta = MONITORS.find((m) => m.id === monitor.id)!
      const up = monitor.up === null ? "unknown" : String(monitor.up)
      const bars = el(
        "div",
        { className: "bars", role: "img", ariaLabel: `${meta.name}: ${monitor.uptime === null ? "nog geen gegevens" : `${percent(monitor.uptime)} bereikbaar`} in ${DAYS} dagen` },
        ...monitor.days.map((day) =>
          el("span", { className: "bar", tabIndex: -1, data: { level: level(day), day: day.day, ok: String(day.ok), total: String(day.total) } })
        )
      )
      bars.style.setProperty("--days", String(DAYS))
      const last30 = monitor.days.slice(-30).reduce((acc, d) => ({ ok: acc.ok + d.ok, total: acc.total + d.total }), { ok: 0, total: 0 })
      return el(
        "li",
        { className: "monitor" },
        el("span", { className: "monitor-name" }, el("i", { className: "dot", data: { up } }), meta.name),
        el("span", { className: "monitor-state", data: { up } }, monitor.up === null ? "Onbekend" : monitor.up ? "Werkt" : "Storing"),
        el("span", { className: "monitor-detail" }, meta.detail),
        el("span", { className: "monitor-latency" }, monitor.up && monitor.latencyMs !== null ? `${monitor.latencyMs} ms` : ""),
        bars,
        el(
          "span",
          { className: "range" },
          el("span", {}, el("span", { className: "wide" }, `${DAYS} dagen geleden`), el("span", { className: "narrow" }, "30 dagen geleden")),
          el(
            "span",
            {},
            el("b", { className: "wide" }, monitor.uptime === null ? "–" : percent(monitor.uptime)),
            el("b", { className: "narrow" }, last30.total ? percent(last30.ok / last30.total) : "–"),
            " bereikbaar"
          ),
          el("span", {}, "vandaag")
        )
      )
    })
  )
}

function incidents(data: StatusData) {
  const list = $("incidents")
  if (!data.incidents.length) {
    list.replaceChildren(el("li", { className: "empty" }, `Geen storingen in de afgelopen ${DAYS} dagen.`))
    return
  }
  list.replaceChildren(
    ...data.incidents.map((incident) => {
      const start = new Date(incident.startedAt)
      const end = incident.endedAt ? new Date(incident.endedAt) : null
      const how = end ? `${dateTime.format(start)}, ${lasted(end.getTime() - start.getTime())}` : `sinds ${dateTime.format(start)}`
      return el(
        "li",
        { className: "incident", data: { open: String(!end) } },
        el("span", { className: "incident-title" }, `${nameOf(incident.monitor)} onbereikbaar`),
        el("span", { className: "incident-when" }, how),
        el("span", { className: "incident-cause" }, incident.cause)
      )
    })
  )
}

/** One tooltip for every bar: the day and how it went. */
function tooltips() {
  const tip = $("tip")
  const show = (bar: HTMLElement) => {
    const { day, ok, total } = bar.dataset
    const date = dayLong.format(new Date(`${day}T12:00:00Z`))
    const okCount = Number(ok)
    const totalCount = Number(total)
    const down = totalCount - okCount
    tip.textContent = !totalCount
      ? `${date}: geen gegevens`
      : down
        ? `${date}: ${percent(okCount / totalCount)}, ${down} ${down === 1 ? "minuut" : "minuten"} weg`
        : `${date}: alles goed`
    const rect = bar.getBoundingClientRect()
    tip.hidden = false
    const half = tip.offsetWidth / 2 + 8
    tip.style.left = `${Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half)}px`
    tip.style.top = `${rect.top}px`
  }
  document.addEventListener("pointerover", (event) => {
    const bar = (event.target as HTMLElement).closest<HTMLElement>(".bars .bar")
    if (bar) show(bar)
    else tip.hidden = true
  })
  document.addEventListener("scroll", () => (tip.hidden = true), { passive: true })
}

async function load() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" })
    if (!response.ok) throw new Error(String(response.status))
    const data = (await response.json()) as StatusData
    banner(data)
    monitors(data)
    incidents(data)
  } catch {
    const banner = $("banner")
    if (banner.dataset.state === "loading") {
      banner.dataset.state = "stale"
      $("headline").textContent = "Status niet op te halen"
      $("checked").textContent = "Probeer het zo nog eens."
    }
  }
}

tooltips()
void load()
setInterval(() => {
  if (document.visibilityState === "visible") void load()
}, REFRESH_MS)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void load()
})
