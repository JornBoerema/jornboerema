import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@even/ui/components/skeleton"
import { BarChart } from "@/admin/components/bar-chart"
import { RangePicker, Segmented } from "@/admin/components/range"
import { Change, PageHeader, Stat, TopList } from "@/admin/components/stat"
import { useI18n } from "@/admin/i18n"
import { api } from "@/admin/lib/api"
import { useFormat } from "@/admin/lib/format"
import { useRange } from "@/admin/lib/range"

type Row = { name: string | null; visitors: number; pageviews: number }
type Visitors = {
  days: number
  site: "home" | "app" | null
  visitors: number
  pageviews: number
  previous: { visitors: number; pageviews: number }
  live: number
  bounceRate: number | null
  series: { date: string; visitors: number; pageviews: number }[]
  pages: (Row & { site: string })[]
  referrers: Row[]
  direct: number
  sources: Row[]
  countries: Row[]
  devices: Row[]
  browsers: Row[]
  systems: Row[]
  sites: Row[]
}

type Site = "all" | "home" | "app"
type Measure = "visitors" | "pageviews"

/** "NL" as "🇳🇱 Netherlands", in the reader's language. */
function useCountry() {
  const { locale } = useI18n()
  const names = new Intl.DisplayNames([locale], { type: "region" })
  return (code: string | null, unknown: string) => {
    if (!code) return unknown
    const flag = String.fromCodePoint(...[...code].map((char) => 0x1f1a5 + char.charCodeAt(0)))
    try {
      return `${flag} ${names.of(code) ?? code}`
    } catch {
      return code
    }
  }
}

export function VisitorsPage() {
  const t = useI18n().t.visitors
  const { number, percent } = useFormat()
  const country = useCountry()
  const [days, setDays] = useRange()
  const [site, setSite] = useState<Site>("all")
  const [measure, setMeasure] = useState<Measure>("visitors")
  const query = useQuery({
    queryKey: ["admin-visitors", days, site],
    queryFn: () => api<Visitors>(`/api/admin/visitors?days=${days}${site === "all" ? "" : `&site=${site}`}`),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  })
  const data = query.data
  const rows = (list: Row[], label: (name: string | null) => string = (name) => name ?? t.unknown) =>
    list.map((row) => ({ key: row.name ?? "-", label: label(row.name), value: row.visitors }))
  const siteName = (value: string) => (value === "home" ? t.home : value === "app" ? t.app : value)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t.title}
        description={t.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label={t.site}
              value={site}
              onChange={setSite}
              options={[
                { value: "all", label: t.all },
                { value: "home", label: t.home },
                { value: "app", label: t.app },
              ]}
            />
            <RangePicker value={days} onChange={setDays} />
          </div>
        }
      />
      {query.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      {!data && query.isPending && (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-[104px]" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label={t.visitors} value={number(data.visitors)} detail={<Change now={data.visitors} before={data.previous.visitors} />} />
            <Stat label={t.pageviews} value={number(data.pageviews)} detail={<Change now={data.pageviews} before={data.previous.pageviews} />} />
            <Stat label={t.perVisit} value={data.visitors ? (data.pageviews / data.visitors).toFixed(1) : "—"} />
            <Stat label={t.bounce} value={data.bounceRate === null ? "—" : percent(data.bounceRate)} />
            <Stat label={t.live} value={<span className={data.live ? "text-primary" : undefined}>{number(data.live)}</span>} />
          </div>

          <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
            <div className="flex justify-end">
              <Segmented
                label={t.title}
                value={measure}
                onChange={setMeasure}
                options={[
                  { value: "visitors", label: t.visitors },
                  { value: "pageviews", label: t.pageviews },
                ]}
              />
            </div>
            <BarChart
              height={220}
              label={measure === "visitors" ? t.visitors : t.pageviews}
              points={data.series.map((point) => ({ date: point.date, value: point[measure] }))}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <TopList
              title={t.pages}
              empty={t.empty}
              rows={data.pages.map((row) => ({
                key: `${row.site}${row.name}`,
                label: (
                  <>
                    <span className="font-mono text-[13px]">{row.name}</span>
                    {site === "all" && <span className="ml-2 text-xs text-muted-foreground">{siteName(row.site)}</span>}
                  </>
                ),
                value: row.visitors,
              }))}
            />
            <TopList
              title={t.referrers}
              empty={t.empty}
              rows={[
                ...rows(data.referrers),
                ...(data.direct ? [{ key: "direct", label: t.direct, value: data.direct }] : []),
              ].sort((a, b) => b.value - a.value)}
            />
            <TopList title={t.countries} empty={t.empty} rows={rows(data.countries, (name) => country(name, t.unknown))} />
            {data.sources.length > 0 && <TopList title={t.sources} empty={t.empty} rows={rows(data.sources)} />}
            <TopList
              title={t.devices}
              empty={t.empty}
              total={data.visitors}
              rows={rows(data.devices, (name) => (name ? (t.deviceNames[name] ?? name) : t.unknown))}
            />
            <TopList title={t.browsers} empty={t.empty} total={data.visitors} rows={rows(data.browsers)} />
            <TopList title={t.systems} empty={t.empty} total={data.visitors} rows={rows(data.systems)} />
            {site === "all" && <TopList title={t.site} empty={t.empty} total={data.visitors} rows={rows(data.sites, (name) => siteName(name ?? ""))} />}
          </div>
        </>
      )}
    </div>
  )
}
