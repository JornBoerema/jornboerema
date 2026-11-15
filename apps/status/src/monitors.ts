/** What the page shows. Keep in step with MONITORS in apps/api/trigger/uptime.ts. */
export const MONITORS = [
  { id: "website", name: "Website", detail: "jornboerema.nl" },
  { id: "app", name: "Even web-app", detail: "app.jornboerema.nl: mail, taken, notities" },
  { id: "api", name: "API", detail: "Inloggen, synchroniseren, de desktop- en iPhone-apps" },
] as const

export type MonitorId = (typeof MONITORS)[number]["id"]

export const DAYS = 90

export type Day = { day: string; total: number; ok: number }

export type StatusData = {
  generatedAt: string
  /** The newest check of any monitor; old means the monitor itself stopped. */
  lastCheckAt: string | null
  monitors: {
    id: MonitorId
    up: boolean | null
    lastCheckAt: string | null
    latencyMs: number | null
    /** Share of good checks over the 90 days, 0 to 1. */
    uptime: number | null
    days: Day[]
  }[]
  incidents: { monitor: MonitorId; startedAt: string; endedAt: string | null; cause: string }[]
}
