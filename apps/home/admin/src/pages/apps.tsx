import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { ArrowRight01Icon, Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@evido/ui/components/badge"
import { Skeleton } from "@evido/ui/components/skeleton"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"

export type AppSummary = {
  id: string
  name: string
  url: string
  inviteOnly: boolean
  members: number
  invites: number
  requests: number
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={accent ? "text-lg font-semibold text-primary tabular-nums" : "text-lg font-semibold tabular-nums"}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

export function AppsPage() {
  const t = useI18n().t.apps
  const apps = useQuery({ queryKey: ["admin-apps"], queryFn: () => api<{ apps: AppSummary[] }>("/api/admin/apps") })
  return (
    <section aria-labelledby="apps-title" className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header>
        <h1 id="apps-title" className="text-2xl font-semibold tracking-tight">
          {t.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
      </header>
      {apps.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      {apps.isPending && <Skeleton className="h-28" />}
      <ul className="flex flex-col gap-3">
        {apps.data?.apps.map((app) => (
          <li key={app.id}>
            <Link
              to={`/apps/${app.id}`}
              className="group flex items-center gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} aria-hidden="true" className="size-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">{app.name}</span>
                  <Badge variant="secondary">{app.inviteOnly ? t.inviteOnly : t.open}</Badge>
                </span>
                <div className="flex gap-6 sm:gap-8">
                  <Stat value={app.members} label={t.membersLabel} />
                  <Stat value={app.invites} label={t.invitesLabel} />
                  <Stat value={app.requests} label={t.requestsLabel} accent={app.requests > 0} />
                </div>
              </div>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
