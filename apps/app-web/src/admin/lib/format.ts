import { useEffect, useState } from "react"
import { useI18n } from "@/admin/i18n"

/** Re-renders every so often, so "2 min ago" keeps up. */
export function useNow(interval = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}

export function useFormat() {
  const { locale } = useI18n()
  const now = useNow()
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })
  const number = new Intl.NumberFormat(locale)
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 })
  const dollars = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
  const ago = (value: string | null) => {
    if (!value) return ""
    const seconds = Math.round((new Date(value).getTime() - now) / 1000)
    const abs = Math.abs(seconds)
    if (abs < 45) return relative.format(0, "second")
    if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute")
    if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour")
    if (abs < 86_400 * 60) return relative.format(Math.round(seconds / 86_400), "day")
    return relative.format(Math.round(seconds / (86_400 * 30)), "month")
  }
  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(locale, { dateStyle: "medium" }) : "")
  const full = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : ""
  /** A day key ("2026-11-15") as a short date. */
  const day = (key: string, long = false) =>
    new Date(`${key}T12:00:00`).toLocaleDateString(locale, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" })
  const duration = (from: string, to: string | number) => {
    const seconds = Math.max(0, Math.round(((typeof to === "number" ? to : new Date(to).getTime()) - new Date(from).getTime()) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
  }
  return {
    ago,
    date,
    full,
    day,
    duration,
    now,
    number: (value: number) => number.format(value),
    compact: (value: number) => compact.format(value),
    percent: (value: number) => percent.format(value),
    dollars: (value: number) => dollars.format(value),
  }
}
