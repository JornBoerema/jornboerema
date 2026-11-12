import { env } from "../env"

/**
 * What the admin dashboard shows: GitHub Actions runs, the web updates (each
 * `web-vN` run of web-update.yml, with a deploy job per app) and which version
 * of every app is out. Everything comes from GitHub, so one read-only token
 * (GITHUB_TOKEN) is all it needs.
 */

type RunState = "queued" | "running" | "success" | "failure" | "cancelled" | "skipped"
type DeployState = "building" | "ready" | "skipped" | "failed"

export type ActionRun = {
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

export type Build = {
  project: string
  name: string
  state: DeployState
  description: string
  url: string | null
  updatedAt: string
}

export type Commit = {
  sha: string
  /** The web update's tag, such as web-v3. */
  label: string
  message: string
  author: string | null
  date: string
  url: string
  builds: Build[]
}

export type AppVersion = {
  id: string
  name: string
  kind: "desktop" | "web" | "api" | "jobs"
  /** A version number for desktop apps, else the short commit that is live. */
  version: string | null
  sha: string | null
  /** When it went out. */
  date: string | null
  url: string | null
  state: "live" | "building" | "failed" | "unknown"
  /** Desktop: the version main is at, when it hasn't been released yet. */
  unreleased: string | null
  downloads: number | null
}

export type Status = {
  repo: string
  fetchedAt: string
  versions: AppVersion[]
  runs: ActionRun[]
  commits: Commit[]
  rateLimit: { remaining: number; limit: number; reset: string } | null
}

export class GithubError extends Error {
  code: "github_rate_limited" | "github_unavailable"
  constructor(code: GithubError["code"], message: string) {
    super(message)
    this.code = code
  }
}

/**
 * The web apps a web update puts live, by the package its deploy job is named
 * after ("deploy @evido/mail-web"), in the order the dashboard lists them.
 */
const PROJECTS = [
  { project: "@evido/mail-web", vercel: "even-mailen", name: "Even mailen", kind: "web" },
  { project: "@evido/todo-web", vercel: "even-doen", name: "Even doen", kind: "web" },
  { project: "@evido/notes-web", vercel: "even-noteren", name: "Even noteren", kind: "web" },
  { project: "@evido/capture-web", vercel: "even-vastleggen", name: "Even vastleggen (web)", kind: "web" },
  { project: "@evido/home", vercel: "jornboerema", name: "jornboerema.nl", kind: "web" },
  { project: "@evido/auth-web", vercel: "jornboerema-auth", name: "Account", kind: "web" },
  { project: "@evido/api", vercel: "jornboerema-api", name: "API", kind: "api" },
] as const

const DESKTOP = [
  { id: "even", name: "Even", prefix: "even-v", config: "apps/desktop/src-tauri/tauri.conf.json" },
  { id: "capture", name: "Even vastleggen", prefix: "capture-v", config: "apps/capture-desktop/src-tauri/tauri.conf.json" },
] as const

const TRIGGER_WORKFLOW = "trigger-deploy.yml"
const WEB_WORKFLOW = "web-update.yml"
/** Web updates listed. */
const UPDATES = 8
/** How far back to look for the update a web app still runs. */
const HISTORY = 30

// Conditional requests: an unchanged answer (304) doesn't count against the rate limit.
const etags = new Map<string, { etag: string; body: unknown }>()
let rateLimit: Status["rateLimit"] = null

async function github<T>(path: string): Promise<T> {
  const url = path.startsWith("https://") ? path : `https://api.github.com/repos/${env.githubRepo}${path}`
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "evido-admin",
  }
  if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`
  const cached = etags.get(url)
  if (cached) headers["If-None-Match"] = cached.etag
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  const remaining = response.headers.get("x-ratelimit-remaining")
  const limit = response.headers.get("x-ratelimit-limit")
  const reset = response.headers.get("x-ratelimit-reset")
  if (remaining && limit && reset)
    rateLimit = { remaining: Number(remaining), limit: Number(limit), reset: new Date(Number(reset) * 1000).toISOString() }
  if (response.status === 304 && cached) return cached.body as T
  if ((response.status === 403 || response.status === 429) && remaining === "0")
    throw new GithubError("github_rate_limited", "GitHub rate limit reached")
  if (!response.ok) throw new GithubError("github_unavailable", `GitHub answered ${response.status} for ${path}`)
  const body = (await response.json()) as T
  const etag = response.headers.get("etag")
  if (etag) etags.set(url, { etag, body })
  return body
}

async function rawFile(path: string): Promise<string | null> {
  const response = await fetch(`https://raw.githubusercontent.com/${env.githubRepo}/main/${path}`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  return response?.ok ? response.text() : null
}

type GhRun = {
  id: number
  name: string | null
  display_title: string
  head_branch: string | null
  head_sha: string
  event: string
  status: string | null
  conclusion: string | null
  html_url: string
  actor: { login: string } | null
  run_started_at?: string
  created_at: string
  updated_at: string
}
type GhRelease = {
  tag_name: string
  html_url: string
  published_at: string | null
  draft: boolean
  assets: { download_count: number }[]
}
type GhJob = { name: string; status: string; conclusion: string | null; html_url: string; completed_at: string | null; started_at: string | null }

function runState(run: GhRun): RunState {
  if (run.status !== "completed") return run.status === "in_progress" ? "running" : "queued"
  switch (run.conclusion) {
    case "success":
      return "success"
    case "cancelled":
      return "cancelled"
    case "skipped":
    case "neutral":
      return "skipped"
    default:
      return "failure"
  }
}

function toRun(run: GhRun): ActionRun {
  return {
    id: run.id,
    workflow: run.name ?? "Workflow",
    title: run.display_title,
    ref: run.head_branch ?? "",
    event: run.event,
    sha: run.head_sha,
    state: runState(run),
    url: run.html_url,
    actor: run.actor?.login ?? null,
    startedAt: run.run_started_at ?? run.created_at,
    updatedAt: run.updated_at,
  }
}

function jobState(job: GhJob): DeployState {
  if (job.status !== "completed") return "building"
  if (job.conclusion === "success") return "ready"
  return job.conclusion === "skipped" || job.conclusion === "cancelled" ? "skipped" : "failed"
}

const versionOf = (json: string | null) => {
  try {
    return json ? ((JSON.parse(json) as { version?: string }).version ?? null) : null
  } catch {
    return null
  }
}

async function load(): Promise<Status> {
  const [runs, releases, webRuns, triggerRuns, ...configs] = await Promise.all([
    github<{ workflow_runs: GhRun[] }>("/actions/runs?per_page=25"),
    github<GhRelease[]>("/releases?per_page=60"),
    github<{ workflow_runs: GhRun[] }>(`/actions/workflows/${WEB_WORKFLOW}/runs?per_page=${HISTORY}`).catch(() => ({
      workflow_runs: [],
    })),
    github<{ workflow_runs: GhRun[] }>(`/actions/workflows/${TRIGGER_WORKFLOW}/runs?branch=main&per_page=10`).catch(
      () => ({ workflow_runs: [] })
    ),
    ...DESKTOP.map((app) => rawFile(app.config)),
  ])

  // Each web update and the apps it deployed. Older runs only until every app has a live one.
  const jobsOf = (run: GhRun) => github<{ jobs: GhJob[] }>(`/actions/runs/${run.id}/jobs?per_page=50`)
  const updates: Commit[] = []
  for (const run of webRuns.workflow_runs) {
    const done = updates.length >= UPDATES &&
      PROJECTS.every((project) => updates.some((update) => update.builds.some((b) => b.project === project.project && b.state === "ready")))
    if (done) break
    const { jobs } = await jobsOf(run)
    const builds = jobs
      .map((job) => ({ job, project: PROJECTS.find((item) => job.name === `deploy ${item.project}`) }))
      .filter((item) => item.project)
      .map(({ job, project }): Build => ({
        project: project!.project,
        name: project!.name,
        state: jobState(job),
        description: "",
        url: job.html_url,
        updatedAt: job.completed_at ?? job.started_at ?? run.updated_at,
      }))
      .sort((a, b) => order(a.project) - order(b.project))
    updates.push({
      sha: run.head_sha,
      label: run.head_branch ?? run.head_sha.slice(0, 7),
      message: run.display_title,
      author: run.actor?.login ?? null,
      date: run.run_started_at ?? run.created_at,
      url: run.html_url,
      builds,
    })
  }

  const desktop = DESKTOP.map((app, index): AppVersion => {
    const release = releases
      .filter((item) => !item.draft && item.tag_name.startsWith(app.prefix))
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0]
    const released = release?.tag_name.slice(app.prefix.length) ?? null
    const onMain = versionOf(configs[index] ?? null)
    const building = runs.workflow_runs.some(
      (run) => run.head_branch?.startsWith(app.prefix) && run.status !== "completed"
    )
    return {
      id: app.id,
      name: app.name,
      kind: "desktop",
      version: released,
      sha: null,
      date: release?.published_at ?? null,
      url: release?.html_url ?? null,
      state: building ? "building" : released ? "live" : "unknown",
      unreleased: onMain && onMain !== released ? onMain : null,
      downloads: release ? release.assets.reduce((sum, asset) => sum + asset.download_count, 0) : null,
    }
  })

  // A web app runs what its newest successful deploy put live.
  const web = PROJECTS.map((project): AppVersion => {
    const deploys = updates.flatMap((update) =>
      update.builds.filter((build) => build.project === project.project).map((build) => ({ update, build }))
    )
    const live = deploys.find(({ build }) => build.state === "ready")
    const newest = deploys[0]
    return {
      id: project.project,
      name: project.name,
      kind: project.kind,
      version: live?.update.label ?? null,
      sha: live?.update.sha ?? null,
      date: live?.build.updatedAt ?? null,
      url: live?.update.url ?? `https://vercel.com/jornboeremas-projects/${project.vercel}`,
      state:
        newest?.build.state === "building" ? "building" : newest?.build.state === "failed" ? "failed" : live ? "live" : "unknown",
      unreleased: null,
      downloads: null,
    }
  })

  const triggerRun = triggerRuns.workflow_runs.find((run) => run.status === "completed" && run.conclusion === "success")
  const triggerBusy = triggerRuns.workflow_runs[0]
  const jobs: AppVersion = {
    id: "trigger",
    name: "Trigger.dev tasks",
    kind: "jobs",
    version: triggerRun ? triggerRun.head_sha.slice(0, 7) : null,
    sha: triggerRun?.head_sha ?? null,
    date: triggerRun?.updated_at ?? null,
    url: triggerRun?.html_url ?? null,
    state:
      triggerBusy && triggerBusy.status !== "completed"
        ? "building"
        : triggerBusy && triggerBusy.conclusion === "failure"
          ? "failed"
          : triggerRun
            ? "live"
            : "unknown",
    unreleased: null,
    downloads: null,
  }

  return {
    repo: env.githubRepo,
    fetchedAt: new Date().toISOString(),
    versions: [...desktop, ...web, jobs],
    runs: runs.workflow_runs.map(toRun),
    commits: updates.slice(0, UPDATES),
    rateLimit,
  }
}

const order = (project: string) => {
  const index = PROJECTS.findIndex((item) => item.project === project)
  return index === -1 ? PROJECTS.length : index
}

// One fetch at a time, shared for a few seconds by everyone polling.
let cache: { at: number; value: Promise<Status> } | null = null
const FRESH_MS = 10_000

export function getStatus(): Promise<Status> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache.value
  const value = load()
  cache = { at: Date.now(), value }
  value.catch(() => {
    if (cache?.value === value) cache = null
  })
  return value
}
