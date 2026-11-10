import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@evido/ui/components/badge"
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

export function AppsPage() {
  const t = useI18n().t.apps
  const apps = useQuery({ queryKey: ["admin-apps"], queryFn: () => api<{ apps: AppSummary[] }>("/api/admin/apps") })
  return (
    <section aria-labelledby="apps-title" className="flex flex-col gap-6 pt-6">
      <div>
        <h1 id="apps-title" className="text-2xl font-semibold tracking-tight">
          {t.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
      </div>
      {apps.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      <ul className="flex flex-col gap-2">
        {apps.data?.apps.map((app) => (
          <li key={app.id}>
            <Link
              to={`/apps/${app.id}`}
              className="group flex items-center gap-4 rounded-2xl border px-5 py-4 transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{app.name}</span>
                  <Badge variant="secondary">{app.inviteOnly ? t.inviteOnly : t.open}</Badge>
                </span>
                <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  <span>{t.members(app.members)}</span>
                  {app.invites > 0 && <span>{t.invites(app.invites)}</span>}
                  {app.requests > 0 && <span className="font-medium text-primary">{t.requests(app.requests)}</span>}
                </span>
              </div>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
