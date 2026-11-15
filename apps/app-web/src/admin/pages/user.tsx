import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@even/ui/components/avatar"
import { Badge } from "@even/ui/components/badge"
import { Skeleton } from "@even/ui/components/skeleton"
import { Stat } from "@/admin/components/stat"
import { useI18n } from "@/admin/i18n"
import { api } from "@/admin/lib/api"
import { useFormat } from "@/admin/lib/format"
import { initials } from "@/admin/pages/users"

type Detail = {
  id: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
  twoFactorEnabled: boolean
  createdAt: string
  lastSeen: string | null
  accounts: { providerId: string; createdAt: string }[]
  passkeys: { name: string | null; createdAt: string | null }[]
  mailAccounts: { id: string; email: string; provider: "gmail" | "outlook"; status: string; createdAt: string }[]
  organizations: {
    id: string
    name: string
    personal: boolean
    members: number
    lists: number
    role: string
    subscription: { plan: string; status: string; seats: number | null; periodEnd: string | null; cancelAtPeriodEnd: boolean | null } | null
  }[]
  appAccess: { app: string; grantedAt: string; grantedBy: string | null }[]
  appAccessRequests: { app: string; createdAt: string }[]
  sessions: { createdAt: string; updatedAt: string; expiresAt: string; client: string | null; active: boolean }[]
  ai: { month: string; feature: string; requests: number; cost: number }[]
  lists: number
  todos: number
  pushDevices: number
  connections: number
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

const Panel = ({ children }: { children: ReactNode }) => (
  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{children}</ul>
)
const Row = ({ children }: { children: ReactNode }) => (
  <li className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm">{children}</li>
)
const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{children}</p>
)

export function UserPage() {
  const { id = "" } = useParams()
  const { t } = useI18n()
  const tu = t.user
  const { ago, date, full, number, dollars } = useFormat()
  const query = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => api<{ user: Detail; admin: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`),
    retry: false,
  })
  const user = query.data?.user
  const aiByMonth = user
    ? [...new Set(user.ai.map((row) => row.month))].map((month) => {
        const rows = user.ai.filter((row) => row.month === month)
        return { month, requests: rows.reduce((s, r) => s + r.requests, 0), cost: rows.reduce((s, r) => s + r.cost, 0) }
      })
    : []

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <Link to="/users" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden="true" className="size-4" />
        {tu.back}
      </Link>
      {query.isPending && <Skeleton className="h-64" />}
      {query.isError && <Empty>{tu.notFound}</Empty>}
      {user && (
        <>
          <header className="flex items-center gap-4">
            <Avatar className="size-14">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback>{initials(user)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
                <span className="truncate">{user.name || user.email}</span>
                {query.data?.admin && <Badge>{tu.admin}</Badge>}
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                {user.email} · <span title={full(user.createdAt)}>{tu.joined(date(user.createdAt))}</span>
                {user.lastSeen && (
                  <>
                    {" "}
                    · <span title={full(user.lastSeen)}>{tu.lastSeen(ago(user.lastSeen))}</span>
                  </>
                )}
              </p>
            </div>
          </header>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={tu.lists} value={number(user.lists)} />
            <Stat label={tu.todos} value={number(user.todos)} />
            <Stat label={tu.pushDevices} value={number(user.pushDevices)} />
            <Stat label={tu.connections} value={number(user.connections)} />
          </div>

          <Section title={tu.signIn}>
            <Panel>
              <Row>
                <span className="flex-1">{user.emailVerified ? tu.verified : tu.notVerified}</span>
                {!user.emailVerified && <Badge variant="outline">!</Badge>}
              </Row>
              <Row>
                <span className="flex-1">{user.twoFactorEnabled ? tu.twoFactorOn : tu.twoFactorOff}</span>
                {user.passkeys.length > 0 && <span className="text-xs text-muted-foreground">{tu.passkeys(user.passkeys.length)}</span>}
              </Row>
              {user.accounts.map((account) => (
                <Row key={account.providerId}>
                  <span className="flex-1">{t.users.providers[account.providerId] ?? account.providerId}</span>
                  <span className="text-xs text-muted-foreground">{date(account.createdAt)}</span>
                </Row>
              ))}
            </Panel>
          </Section>

          <Section title={tu.organizations}>
            <Panel>
              {user.organizations.map((org) => (
                <Row key={org.id}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{org.name}</span>
                      {org.personal && <Badge variant="secondary">{tu.personal}</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tu.roles[org.role] ?? org.role} · {tu.orgDetail(org.members, org.lists)}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {org.subscription
                      ? `${tu.plan(org.subscription.plan, org.subscription.status)}${org.subscription.seats ? ` · ${org.subscription.seats}×` : ""}`
                      : tu.noPlan}
                  </span>
                </Row>
              ))}
            </Panel>
          </Section>

          <Section title={tu.mailboxes}>
            {user.mailAccounts.length === 0 ? (
              <Empty>{tu.noMailboxes}</Empty>
            ) : (
              <Panel>
                {user.mailAccounts.map((mailbox) => (
                  <Row key={mailbox.id}>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{mailbox.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {mailbox.provider === "gmail" ? "Gmail" : "Outlook"} · {date(mailbox.createdAt)}
                      </span>
                    </div>
                    {mailbox.status !== "active" && <span className="text-xs text-destructive">{tu.needsReauth}</span>}
                  </Row>
                ))}
              </Panel>
            )}
          </Section>

          <Section title={tu.access}>
            {user.appAccess.length + user.appAccessRequests.length === 0 ? (
              <Empty>{tu.noAccess}</Empty>
            ) : (
              <Panel>
                {user.appAccess.map((access) => (
                  <Row key={access.app}>
                    <Link to={`/apps/${access.app}`} className="flex-1 hover:underline">
                      {access.app}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {date(access.grantedAt)}
                      {access.grantedBy && ` · ${access.grantedBy}`}
                    </span>
                  </Row>
                ))}
                {user.appAccessRequests.map((request) => (
                  <Row key={`request-${request.app}`}>
                    <Link to={`/apps/${request.app}`} className="flex-1 hover:underline">
                      {request.app}
                    </Link>
                    <Badge variant="outline">{tu.requested}</Badge>
                    <span className="text-xs text-muted-foreground">{date(request.createdAt)}</span>
                  </Row>
                ))}
              </Panel>
            )}
          </Section>

          <Section title={tu.ai}>
            {aiByMonth.length === 0 ? (
              <Empty>{tu.noAi}</Empty>
            ) : (
              <Panel>
                {aiByMonth.map((row) => (
                  <Row key={row.month}>
                    <span className="flex-1 font-mono text-[13px]">{row.month}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{number(row.requests)}×</span>
                    <span className="w-20 text-right tabular-nums">{dollars(row.cost)}</span>
                  </Row>
                ))}
              </Panel>
            )}
          </Section>

          {user.sessions.length > 0 && (
            <Section title={tu.sessions}>
              <Panel>
                {user.sessions.map((session, index) => (
                  <Row key={index}>
                    <span className="min-w-0 flex-1 truncate">{session.client ?? "—"}</span>
                    <span className="text-xs text-muted-foreground" title={full(session.updatedAt)}>
                      {ago(session.updatedAt)}
                    </span>
                    <Badge variant={session.active ? "secondary" : "outline"}>
                      {session.active ? tu.sessionActive : tu.sessionExpired}
                    </Badge>
                  </Row>
                ))}
              </Panel>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
