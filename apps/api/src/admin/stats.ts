import { Prisma, getDb } from "@even/db"

/** What the admin's overview, visitors and users pages show. Days are Amsterdam days. */

const TZ = "Europe/Amsterdam"
export const RANGES = [7, 30, 90, 365] as const

export function rangeOf(value: string | undefined) {
  const days = Number(value)
  return (RANGES as readonly number[]).includes(days) ? days : 30
}

/** The first moment of the day `days - 1` days before today, in Amsterdam, as UTC. */
function startOf(days: number, offset = 0) {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }))
  const shift = Date.now() - local.getTime()
  local.setHours(0, 0, 0, 0)
  local.setDate(local.getDate() - (days - 1) - offset)
  return new Date(local.getTime() + shift)
}

function dayKeys(days: number) {
  const keys: string[] = []
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }))
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today)
    day.setDate(today.getDate() - i)
    keys.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`)
  }
  return keys
}

const localDay = (column: string) => Prisma.raw(`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`)

const num = (value: unknown) => Number(value ?? 0)

type DayRow = { day: string; visitors: bigint; pageviews: bigint }

async function visitorSeries(since: Date, days: number, site: string | null) {
  const where = site ? Prisma.sql`and site = ${site}` : Prisma.empty
  const rows = await getDb().$queryRaw<DayRow[]>`
    select ${localDay("created_at")} as day, count(distinct visitor) as visitors, count(*) as pageviews
    from page_views where created_at >= ${since} ${where} group by 1`
  const byDay = new Map(rows.map((row) => [row.day, row]))
  return dayKeys(days).map((day) => ({
    date: day,
    visitors: num(byDay.get(day)?.visitors),
    pageviews: num(byDay.get(day)?.pageviews),
  }))
}

/** Visitors are counted once a day (the hash changes daily), so a period's visitors is the sum of its days. */
async function visitorTotals(from: Date, to: Date | null, site: string | null) {
  const where = site ? Prisma.sql`and site = ${site}` : Prisma.empty
  const until = to ? Prisma.sql`and created_at < ${to}` : Prisma.empty
  const [row] = await getDb().$queryRaw<{ visitors: bigint; pageviews: bigint }[]>`
    select coalesce(sum(v), 0) as visitors, coalesce(sum(p), 0) as pageviews from (
      select count(distinct visitor) as v, count(*) as p from page_views
      where created_at >= ${from} ${until} ${where} group by ${localDay("created_at")}
    ) days`
  return { visitors: num(row?.visitors), pageviews: num(row?.pageviews) }
}

async function activeUsers(since: Date) {
  const [row] = await getDb().$queryRaw<{ count: bigint }[]>`
    select count(distinct user_id) as count from session where updated_at >= ${since} or created_at >= ${since}`
  return num(row?.count)
}

export async function overview(days: number) {
  const db = getDb()
  const since = startOf(days)
  const before = startOf(days, days)
  const now = Date.now()
  const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000)
  const month = new Date().toISOString().slice(0, 7)

  const [
    series,
    current,
    previous,
    users,
    verified,
    newUsers,
    newBefore,
    signupRows,
    active1,
    active7,
    active30,
    mailboxes,
    lists,
    todos,
    todosDone,
    todosNew,
    organizations,
    ai,
    subscriptions,
    requests,
    live,
  ] = await Promise.all([
    visitorSeries(since, days, null),
    visitorTotals(since, null, null),
    visitorTotals(before, since, null),
    db.user.count(),
    db.user.count({ where: { emailVerified: true } }),
    db.user.count({ where: { createdAt: { gte: since } } }),
    db.user.count({ where: { createdAt: { gte: before, lt: since } } }),
    db.$queryRaw<{ day: string; count: bigint }[]>`
      select ${localDay("created_at")} as day, count(*) as count from "user" where created_at >= ${since} group by 1`,
    activeUsers(hoursAgo(24)),
    activeUsers(hoursAgo(24 * 7)),
    activeUsers(hoursAgo(24 * 30)),
    db.mailAccount.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
    db.list.groupBy({ by: ["kind"], _count: { _all: true } }),
    db.todo.count(),
    db.todo.count({ where: { completed: true } }),
    db.todo.count({ where: { createdAt: { gte: since } } }),
    db.organization.groupBy({ by: ["personal"], _count: { _all: true } }),
    db.aiUsage.groupBy({
      by: ["feature"],
      where: { month },
      _sum: { requests: true, inputTokens: true, outputTokens: true, costMicros: true },
    }),
    db.subscription.groupBy({ by: ["status"], _count: { _all: true }, _sum: { seats: true } }),
    db.appAccessRequest.count(),
    db.$queryRaw<{ count: bigint }[]>`
      select count(distinct visitor) as count from page_views where created_at >= ${new Date(now - 5 * 60_000)}`,
  ])

  const signups = new Map(signupRows.map((row) => [row.day, num(row.count)]))
  const mailbox = (provider: string) =>
    mailboxes.filter((row) => row.provider === provider).reduce((sum, row) => sum + row._count._all, 0)
  const listCount = (kind: string) => lists.find((row) => row.kind === kind)?._count._all ?? 0
  const live_ = subscriptions.filter((row) => ["active", "trialing", "past_due"].includes(row.status))

  return {
    days,
    visitors: {
      ...current,
      previous,
      live: num(live[0]?.count),
      series,
    },
    users: {
      total: users,
      verified,
      new: newUsers,
      newPrevious: newBefore,
      active: { day: active1, week: active7, month: active30 },
      series: dayKeys(days).map((date) => ({ date, count: signups.get(date) ?? 0 })),
    },
    usage: {
      mailboxes: {
        gmail: mailbox("gmail"),
        outlook: mailbox("outlook"),
        reauth: mailboxes.filter((row) => row.status === "reauth_required").reduce((sum, row) => sum + row._count._all, 0),
      },
      lists: { todo: listCount("todo"), board: listCount("board"), note: listCount("note") },
      todos: { total: todos, done: todosDone, new: todosNew },
      organizations: {
        personal: organizations.find((row) => row.personal)?._count._all ?? 0,
        shared: organizations.find((row) => !row.personal)?._count._all ?? 0,
      },
      ai: {
        month,
        features: ai
          .map((row) => ({
            feature: row.feature,
            requests: row._sum.requests ?? 0,
            tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
            cost: (row._sum.costMicros ?? 0) / 1_000_000,
          }))
          .sort((a, b) => b.cost - a.cost),
      },
      subscriptions: {
        paying: live_.reduce((sum, row) => sum + row._count._all, 0),
        seats: live_.reduce((sum, row) => sum + (row._sum.seats ?? 0), 0),
        byStatus: subscriptions.map((row) => ({ status: row.status, count: row._count._all })),
      },
      requests,
    },
  }
}

type Count = { name: string | null; visitors: bigint; pageviews: bigint }

export async function visitors(days: number, site: string | null) {
  const since = startOf(days)
  const where = site ? Prisma.sql`and site = ${site}` : Prisma.empty
  const top = async (column: string, limit = 10) => {
    const rows = await getDb().$queryRaw<Count[]>`
      select ${Prisma.raw(column)} as name, count(distinct (visitor, ${localDay("created_at")})) as visitors, count(*) as pageviews
      from page_views where created_at >= ${since} ${where}
      group by 1 order by 2 desc, 3 desc limit ${limit}`
    return rows.map((row) => ({ name: row.name, visitors: num(row.visitors), pageviews: num(row.pageviews) }))
  }
  const [series, totals, previous, pages, referrers, sources, countries, devices, browsers, systems, sites, live] =
    await Promise.all([
      visitorSeries(since, days, site),
      visitorTotals(since, null, site),
      visitorTotals(startOf(days, days), since, site),
      top("site || ' ' || path", 15),
      top("referrer"),
      top("source"),
      top("country"),
      top("device", 3),
      top("browser", 6),
      top("os", 6),
      top("site", 2),
      getDb().$queryRaw<{ count: bigint }[]>`
        select count(distinct visitor) as count from page_views where created_at >= ${new Date(Date.now() - 5 * 60_000)} ${where}`,
    ])
  // Visitors who saw one page that day: how many leave straight away.
  const [bounce] = await getDb().$queryRaw<{ single: bigint; all: bigint }[]>`
    select count(*) filter (where views = 1) as single, count(*) as all from (
      select count(*) as views from page_views where created_at >= ${since} ${where}
      group by visitor, ${localDay("created_at")}
    ) visits`
  return {
    days,
    site,
    ...totals,
    previous,
    live: num(live[0]?.count),
    bounceRate: num(bounce?.all) ? num(bounce?.single) / num(bounce?.all) : null,
    series,
    pages: pages.map((row) => {
      const [name = "", ...rest] = (row.name ?? "").split(" ")
      return { ...row, site: name, name: rest.join(" ") }
    }),
    referrers: referrers.filter((row) => row.name),
    direct: referrers.find((row) => !row.name)?.visitors ?? 0,
    sources: sources.filter((row) => row.name),
    countries,
    devices,
    browsers,
    systems,
    sites,
  }
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  emailVerified: true,
  twoFactorEnabled: true,
  createdAt: true,
} as const

async function lastSeen(ids: string[]) {
  if (!ids.length) return new Map<string, Date>()
  const rows = await getDb().session.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _max: { updatedAt: true } })
  return new Map(rows.map((row) => [row.userId, row._max.updatedAt!]))
}

export async function userList(query: string) {
  const db = getDb()
  const q = query.trim()
  const users = await db.user.findMany({
    where: q
      ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
      : undefined,
    select: {
      ...userSelect,
      accounts: { select: { providerId: true } },
      _count: { select: { mailAccounts: true, members: true, passkeys: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })
  const seen = await lastSeen(users.map((user) => user.id))
  return users.map(({ accounts, _count, ...user }) => ({
    ...user,
    providers: [...new Set(accounts.map((account) => account.providerId))],
    mailboxes: _count.mailAccounts,
    organizations: _count.members,
    passkeys: _count.passkeys,
    lastSeen: seen.get(user.id) ?? null,
  }))
}

export async function userDetail(id: string) {
  const db = getDb()
  const user = await db.user.findUnique({
    where: { id },
    select: {
      ...userSelect,
      accounts: { select: { providerId: true, createdAt: true } },
      passkeys: { select: { name: true, createdAt: true } },
      mailAccounts: { select: { id: true, email: true, provider: true, status: true, createdAt: true } },
      members: {
        select: {
          role: true,
          organization: { select: { id: true, name: true, personal: true, _count: { select: { members: true, lists: true } } } },
        },
      },
      appAccess: { select: { app: true, grantedAt: true, grantedBy: true } },
      appAccessRequests: { select: { app: true, createdAt: true } },
      sessions: { select: { createdAt: true, updatedAt: true, expiresAt: true, userAgent: true }, orderBy: { updatedAt: "desc" }, take: 10 },
      aiUsage: { select: { month: true, feature: true, requests: true, costMicros: true }, orderBy: { month: "desc" }, take: 24 },
      _count: { select: { lists: true, mailPushDevices: true, connections: true } },
    },
  })
  if (!user) return null
  const orgIds = user.members.map((member) => member.organization.id)
  const [todos, subscriptions] = await Promise.all([
    db.todo.count({ where: { list: { userId: id } } }),
    db.subscription.findMany({
      where: { referenceId: { in: orgIds } },
      select: { referenceId: true, plan: true, status: true, seats: true, periodEnd: true, cancelAtPeriodEnd: true },
    }),
  ])
  const { sessions, aiUsage, _count, members, ...rest } = user
  return {
    ...rest,
    organizations: members.map((member) => ({
      ...member.organization,
      members: member.organization._count.members,
      lists: member.organization._count.lists,
      role: member.role,
      subscription: subscriptions.find((sub) => sub.referenceId === member.organization.id) ?? null,
    })),
    sessions: sessions.map((session) => ({
      ...session,
      client: session.userAgent ? clientOf(session.userAgent) : null,
      active: session.expiresAt > new Date(),
    })),
    ai: aiUsage.map((row) => ({ ...row, cost: row.costMicros / 1_000_000 })),
    lists: _count.lists,
    todos,
    pushDevices: _count.mailPushDevices,
    connections: _count.connections,
    lastSeen: sessions[0]?.updatedAt ?? null,
  }
}

function clientOf(ua: string) {
  if (/tauri|even\//i.test(ua)) return "Even desktop"
  if (/cfnetwork|darwin/i.test(ua) && !/mozilla/i.test(ua)) return "iOS app"
  const browser = /edg\//i.test(ua) ? "Edge" : /firefox/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Browser"
  const os = /iphone|ipad/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /mac os/i.test(ua) ? "macOS" : /windows/i.test(ua) ? "Windows" : /linux/i.test(ua) ? "Linux" : ""
  return os ? `${browser} · ${os}` : browser
}
