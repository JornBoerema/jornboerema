import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Skeleton } from "@even/ui/components/skeleton"
import { BarChart } from "@/admin/components/bar-chart"
import { RangePicker } from "@/admin/components/range"
import { Change, PageHeader, Stat } from "@/admin/components/stat"
import { useI18n } from "@/admin/i18n"
import { api } from "@/admin/lib/api"
import { useFormat } from "@/admin/lib/format"
import { useRange } from "@/admin/lib/range"

type Totals = { visitors: number; pageviews: number }
export type Overview = {
  days: number
  visitors: Totals & { previous: Totals; live: number; series: { date: string; visitors: number; pageviews: number }[] }
  users: {
    total: number
    verified: number
    new: number
    newPrevious: number
    active: { day: number; week: number; month: number }
    series: { date: string; count: number }[]
  }
  usage: {
    mailboxes: { gmail: number; outlook: number; reauth: number }
    lists: { todo: number; board: number; note: number }
    todos: { total: number; done: number; new: number }
    organizations: { personal: number; shared: number }
    ai: { month: string; features: { feature: string; requests: number; tokens: number; cost: number }[] }
    subscriptions: { paying: number; seats: number; byStatus: { status: string; count: number }[] }
    requests: number
  }
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function More({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {label}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden="true" className="size-3.5" />
    </Link>
  )
}

export function OverviewPage() {
  const t = useI18n().t.overview
  const { number, dollars, compact } = useFormat()
  const [days, setDays] = useRange()
  const query = useQuery({
    queryKey: ["admin-overview", days],
    queryFn: () => api<Overview>(`/api/admin/overview?days=${days}`),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  })
  const data = query.data
  const aiTotal = data?.usage.ai.features.reduce((sum, row) => sum + row.cost, 0) ?? 0

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t.title} description={t.description} action={<RangePicker value={days} onChange={setDays} />} />
      {query.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      {!data && query.isPending && (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-[104px]" />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label={t.visitors}
              value={number(data.visitors.visitors)}
              detail={<Change now={data.visitors.visitors} before={data.visitors.previous.visitors} />}
            />
            <Stat
              label={t.pageviews}
              value={number(data.visitors.pageviews)}
              detail={data.visitors.live > 0 ? <span className="text-primary">{t.liveNow(data.visitors.live)}</span> : <Change now={data.visitors.pageviews} before={data.visitors.previous.pageviews} />}
            />
            <Stat label={t.users} value={number(data.users.total)} detail={t.verified(data.users.verified)} />
            <Stat label={t.newUsers} value={number(data.users.new)} detail={<Change now={data.users.new} before={data.users.newPrevious} />} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title={t.visitorsPerDay} action={<More to={`/visitors${days === 30 ? "" : `?days=${days}`}`} label={t.seeVisitors} />}>
              <BarChart label={t.visitorsPerDay} points={data.visitors.series.map((p) => ({ date: p.date, value: p.visitors }))} />
            </Card>
            <Card title={t.signups} action={<More to="/users" label={t.seeUsers} />}>
              <BarChart label={t.signups} points={data.users.series.map((p) => ({ date: p.date, value: p.count }))} />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
            <Stat label={t.activeDay} value={number(data.users.active.day)} detail={t.activeHelp} />
            <Stat label={t.activeWeek} value={number(data.users.active.week)} />
            <Stat label={t.activeMonth} value={number(data.users.active.month)} />
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="px-1 text-sm font-medium">{t.usage}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Stat
                label={t.mailboxes}
                value={number(data.usage.mailboxes.gmail + data.usage.mailboxes.outlook)}
                detail={
                  data.usage.mailboxes.reauth > 0 ? (
                    <span className="text-destructive">{t.reauth(data.usage.mailboxes.reauth)}</span>
                  ) : (
                    t.mailboxesDetail(data.usage.mailboxes.gmail, data.usage.mailboxes.outlook)
                  )
                }
              />
              <Stat
                label={t.lists}
                value={number(data.usage.lists.todo + data.usage.lists.board + data.usage.lists.note)}
                detail={t.listsDetail(data.usage.lists.todo, data.usage.lists.board, data.usage.lists.note)}
              />
              <Stat label={t.todos} value={number(data.usage.todos.total)} detail={t.todosDetail(data.usage.todos.done, data.usage.todos.new)} />
              <Stat
                label={t.organizations}
                value={number(data.usage.organizations.shared)}
                detail={t.organizationsDetail(data.usage.organizations.personal)}
              />
              <Stat
                label={t.subscriptions}
                value={number(data.usage.subscriptions.paying)}
                detail={t.seatsDetail(data.usage.subscriptions.seats)}
              />
              <Link to="/apps" className="rounded-2xl focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none">
                <Stat
                  label={t.requests}
                  value={<span className={data.usage.requests > 0 ? "text-primary" : undefined}>{number(data.usage.requests)}</span>}
                  className="h-full transition-colors hover:border-foreground/20 hover:bg-accent/40"
                />
              </Link>
            </div>
          </section>

          <Card title={t.ai(data.usage.ai.month)} action={<span className="text-sm font-medium tabular-nums">{dollars(aiTotal)}</span>}>
            {data.usage.ai.features.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.aiEmpty}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-normal">{t.aiFeature}</th>
                    <th className="pb-2 text-right font-normal">{t.aiRequests}</th>
                    <th className="pb-2 text-right font-normal">{t.aiTokens}</th>
                    <th className="pb-2 text-right font-normal">{t.aiCost}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.usage.ai.features.map((row) => (
                    <tr key={row.feature}>
                      <td className="py-2">{t.features[row.feature] ?? row.feature}</td>
                      <td className="py-2 text-right tabular-nums">{number(row.requests)}</td>
                      <td className="py-2 text-right tabular-nums">{compact(row.tokens)}</td>
                      <td className="py-2 text-right tabular-nums">{dollars(row.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
