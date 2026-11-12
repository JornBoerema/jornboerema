import { useEffect, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Alert02Icon,
  ArrowUpRight01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CloudServerIcon,
  ComputerIcon,
  Globe02Icon,
  Loading03Icon,
  MinusSignCircleIcon,
  RefreshIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@evido/ui/lib/utils"
import { Button } from "@evido/ui/components/button"
import { Skeleton } from "@evido/ui/components/skeleton"
import { useI18n } from "@/i18n"
import { ApiError, api } from "@/lib/api"

type RunState = "queued" | "running" | "success" | "failure" | "cancelled" | "skipped"
type BuildState = "building" | "ready" | "skipped" | "failed"
type VersionState = "live" | "building" | "failed" | "unknown"
type State = RunState | BuildState | VersionState

type ActionRun = {
  id: number
  workflow: string
  title: string
  ref: string
  event: string
  sha: string
  state: RunState
  url: string
  actor: string | null
  startedAt: string
  updatedAt: string
}
type Build = { project: string; name: string; state: BuildState; description: string; url: string | null; updatedAt: string }
type Commit = { sha: string; label: string; message: string; author: string | null; date: string; url: string; builds: Build[] }
type AppVersion = {
  id: string
  name: string
  kind: "desktop" | "web" | "api" | "jobs"
  version: string | null
  sha: string | null
  date: string | null
  url: string | null
  state: VersionState
  unreleased: string | null
  downloads: number | null
}
type Status = {
  repo: string
  fetchedAt: string
  versions: AppVersion[]
  runs: ActionRun[]
  commits: Commit[]
  rateLimit: { remaining: number; limit: number; reset: string } | null
  tokenConfigured: boolean
}

const busy = (state: State) => state === "running" || state === "queued" || state === "building"

/** Re-renders every so often, so "2 min ago" keeps up. */
function useNow(interval = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}

function useFormat() {
  const { locale } = useI18n()
  const now = useNow()
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })
  const ago = (value: string | null) => {
    if (!value) return ""
    const seconds = Math.round((new Date(value).getTime() - now) / 1000)
    const abs = Math.abs(seconds)
    if (abs < 45) return relative.format(0, "second")
    if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute")
    if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour")
    return relative.format(Math.round(seconds / 86_400), "day")
  }
  const duration = (from: string, to: string | number) => {
    const seconds = Math.max(0, Math.round(((typeof to === "number" ? to : new Date(to).getTime()) - new Date(from).getTime()) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
  }
  const full = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : ""
  return { ago, duration, full, now }
}

const STATE_ICON: Record<State, { icon: typeof Clock01Icon; className: string; spin?: boolean }> = {
  success: { icon: CheckmarkCircle02Icon, className: "text-emerald-600 dark:text-emerald-400" },
  ready: { icon: CheckmarkCircle02Icon, className: "text-emerald-600 dark:text-emerald-400" },
  live: { icon: CheckmarkCircle02Icon, className: "text-emerald-600 dark:text-emerald-400" },
  failure: { icon: CancelCircleIcon, className: "text-destructive" },
  failed: { icon: CancelCircleIcon, className: "text-destructive" },
  running: { icon: Loading03Icon, className: "text-primary", spin: true },
  building: { icon: Loading03Icon, className: "text-primary", spin: true },
  queued: { icon: Clock01Icon, className: "text-muted-foreground" },
  cancelled: { icon: MinusSignCircleIcon, className: "text-muted-foreground" },
  skipped: { icon: MinusSignCircleIcon, className: "text-muted-foreground/70" },
  unknown: { icon: MinusSignCircleIcon, className: "text-muted-foreground/70" },
}

function StateIcon({ state, className }: { state: State; className?: string }) {
  const t = useI18n().t.dashboard.states
  const { icon, className: tone, spin } = STATE_ICON[state]
  return (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={2}
      role="img"
      aria-label={t[state]}
      className={cn("size-4 shrink-0", tone, spin && "animate-spin", className)}
    />
  )
}

const KIND_ICON = { desktop: ComputerIcon, web: Globe02Icon, api: CloudServerIcon, jobs: ZapIcon } as const

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

const external = { target: "_blank", rel: "noopener noreferrer" } as const

function VersionCard({ app }: { app: AppVersion }) {
  const t = useI18n().t.dashboard
  const { ago, full } = useFormat()
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon icon={KIND_ICON[app.kind]} strokeWidth={2} aria-hidden="true" className="size-3.5" />
          {t.kinds[app.kind]}
        </span>
        <StateIcon state={app.state} className="size-3.5" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{app.name}</span>
        <span className="truncate font-mono text-xl font-medium tracking-tight tabular-nums">
          {app.version ? (app.kind === "desktop" ? `v${app.version}` : app.version) : "—"}
        </span>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {app.state === "building" ? (
          <span className="font-medium text-primary">{t.states.building}</span>
        ) : app.state === "failed" ? (
          <span className="font-medium text-destructive">{t.lastBuildFailed}</span>
        ) : (
          <span title={full(app.date)}>{app.date ? ago(app.date) : t.notFound}</span>
        )}
        {app.downloads !== null && <span>· {t.downloads(app.downloads)}</span>}
      </div>
      {app.unreleased && (
        <span className="w-fit rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {t.unreleased(app.unreleased)}
        </span>
      )}
    </>
  )
  const className =
    "group flex min-h-36 flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
  return app.url ? (
    <a href={app.url} {...external} className={cn(className, "hover:border-foreground/20 hover:bg-accent/40")}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  )
}

function RunRow({ run }: { run: ActionRun }) {
  const t = useI18n().t.dashboard
  const { ago, duration, full, now } = useFormat()
  const running = busy(run.state)
  return (
    <li>
      <a
        href={run.url}
        {...external}
        className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
      >
        <StateIcon state={run.state} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm">{run.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 font-medium text-foreground/80">{run.workflow}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate font-mono">{run.ref}</span>
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground tabular-nums">
          <span title={full(run.startedAt)}>{ago(run.startedAt)}</span>
          <span>
            {running
              ? run.state === "queued"
                ? t.states.queued
                : duration(run.startedAt, now)
              : duration(run.startedAt, run.updatedAt)}
          </span>
        </div>
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          strokeWidth={2}
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden"
        />
      </a>
    </li>
  )
}

function BuildChip({ build }: { build: Build }) {
  const t = useI18n().t.dashboard.states
  const content = (
    <>
      <StateIcon state={build.state} className="size-3.5" />
      <span className="truncate">{build.name}</span>
    </>
  )
  const className = cn(
    "flex h-7 min-w-0 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
    build.state === "skipped" ? "border-dashed text-muted-foreground" : "bg-card",
    build.state === "failed" && "border-destructive/40",
    build.url && "hover:border-foreground/20 hover:bg-accent/40"
  )
  const title = `${build.name}: ${t[build.state]}${build.description ? ` (${build.description})` : ""}`
  return build.url ? (
    <a href={build.url} {...external} className={className} title={title}>
      {content}
    </a>
  ) : (
    <span className={className} title={title}>
      {content}
    </span>
  )
}

function CommitRow({ commit }: { commit: Commit }) {
  const { ago, full } = useFormat()
  const built = commit.builds.filter((build) => build.state !== "skipped")
  const skipped = commit.builds.filter((build) => build.state === "skipped")
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <a
          href={commit.url}
          {...external}
          className="mt-px shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {commit.label}
        </a>
        <span className="min-w-0 flex-1 truncate text-sm">{commit.message}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={full(commit.date)}>
          {ago(commit.date)}
        </span>
      </div>
      {commit.builds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...built, ...skipped].map((build) => (
            <BuildChip key={build.project} build={build} />
          ))}
        </div>
      )}
    </li>
  )
}

const Panel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <ul className={cn("divide-y overflow-hidden rounded-2xl border bg-card", className)}>{children}</ul>
)

function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

export function DashboardPage() {
  const t = useI18n().t.dashboard
  const { ago, full } = useFormat()
  const [showAllRuns, setShowAllRuns] = useState(false)
  const status = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => api<Status>("/api/admin/status"),
    // Faster while something is building, so it is seen finishing.
    refetchInterval: (query) => {
      const data = query.state.data
      const active =
        data &&
        (data.runs.some((run) => busy(run.state)) ||
          data.commits.some((commit) => commit.builds.some((build) => busy(build.state))))
      return active ? 8_000 : 45_000
    },
    retry: false,
  })

  const data = status.data
  const errorCode = status.error instanceof ApiError ? status.error.message : null
  const active = data
    ? [
        ...data.runs.filter((run) => busy(run.state)).map((run) => ({ kind: "run" as const, run })),
        ...data.commits.flatMap((commit) =>
          commit.builds.filter((build) => busy(build.state)).map((build) => ({ kind: "build" as const, build, commit }))
        ),
      ]
    : []
  const runs = data ? (showAllRuns ? data.runs : data.runs.slice(0, 8)) : []

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {data && <span title={full(data.fetchedAt)}>{t.updated(ago(data.fetchedAt))}</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void status.refetch()}
            disabled={status.isFetching}
            aria-label={t.refresh}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              aria-hidden="true"
              className={cn(status.isFetching && "animate-spin")}
            />
            {t.refresh}
          </Button>
        </div>
      </header>

      {(status.isError || (data && !data.tokenConfigured)) && (
        <div
          role={status.isError ? "alert" : undefined}
          className={cn(
            "flex gap-3 rounded-2xl border px-4 py-3 text-sm",
            status.isError ? "border-destructive/30 bg-destructive/5" : "bg-muted/40"
          )}
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            aria-hidden="true"
            className={cn("mt-0.5 size-4 shrink-0", status.isError ? "text-destructive" : "text-muted-foreground")}
          />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">
              {errorCode === "github_rate_limited" ? t.rateLimited : status.isError ? t.loadFailed : t.noToken}
            </span>
            <span className="text-muted-foreground">{t.tokenHelp}</span>
          </div>
        </div>
      )}

      {!data && status.isPending && <Loading />}

      {data && (
        <>
          {active.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title={t.active} />
              <Panel className="border-primary/30">
                {active.map((item) =>
                  item.kind === "run" ? (
                    <RunRow key={`run-${item.run.id}`} run={item.run} />
                  ) : (
                    <li key={`build-${item.commit.sha}-${item.build.project}`}>
                      <a
                        href={item.build.url ?? item.commit.url}
                        {...external}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                      >
                        <StateIcon state={item.build.state} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm">{item.commit.message}</span>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">{item.build.name}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{item.commit.label}</span>
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{ago(item.build.updatedAt)}</span>
                      </a>
                    </li>
                  )
                )}
              </Panel>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <SectionHeader title={t.versions} description={t.versionsHelp} />
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
              {data.versions.map((app) => (
                <VersionCard key={app.id} app={app} />
              ))}
            </div>
          </section>

          <div className="grid gap-10 xl:grid-cols-2 xl:gap-6">
            <section className="flex min-w-0 flex-col gap-3">
              <SectionHeader
                title={t.actions}
                description={t.actionsHelp}
                action={
                  <a
                    href={`https://github.com/${data.repo}/actions`}
                    {...external}
                    className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    GitHub
                    <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} aria-hidden="true" className="size-3.5" />
                  </a>
                }
              />
              {data.runs.length === 0 ? (
                <p className="rounded-2xl border border-dashed px-4 py-4 text-sm text-muted-foreground">{t.noRuns}</p>
              ) : (
                <Panel>
                  {runs.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                  {data.runs.length > 8 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setShowAllRuns((value) => !value)}
                        className="w-full px-4 py-2.5 text-center text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                      >
                        {showAllRuns ? t.showLess : t.showAll(data.runs.length)}
                      </button>
                    </li>
                  )}
                </Panel>
              )}
            </section>

            <section className="flex min-w-0 flex-col gap-3">
              <SectionHeader title={t.builds} description={t.buildsHelp} />
              <Panel>
                {data.commits.map((commit) => (
                  <CommitRow key={commit.sha} commit={commit} />
                ))}
              </Panel>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
