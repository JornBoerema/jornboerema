import { env } from "../env"

/**
 * What the admin dashboard shows: GitHub Actions runs, the Vercel builds per
 * commit (Vercel reports them to GitHub as commit statuses) and which version
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

/** The Vercel projects that build from this repo, in the order the dashboard lists them. */
const PROJECTS = [
  { project: "even-mailen", name: "Even mailen", kind: "web" },
  { project: "even-doen", name: "Even doen", kind: "web" },
  { project: "even-vastleggen", name: "Even vastleggen (web)", kind: "web" },
  { project: "jornboerema", name: "jornboerema.nl", kind: "web" },
  { project: "jornboerema-api", name: "API", kind: "api" },
] as const

const DESKTOP = [
  { id: "even", name: "Even", prefix: "even-v", config: "apps/desktop/src-tauri/tauri.conf.json" },
  { id: "capture", name: "Even vastleggen", prefix: "capture-v", config: "apps/capture-desktop/src-tauri/tauri.conf.json" },
] as const

const TRIGGER_WORKFLOW = "trigger-deploy.yml"
const COMMITS = 8
/** How far back to look for the build a web app still runs. */
const HISTORY = 40

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
type GhCommit = {
  sha: string
  html_url: string
  commit: { message: string; author: { name: string; date: string } | null }
  author: { login: string } | null
}
type GhStatus = { context: string; state: string; description: string | null; target_url: string | null; updated_at: string }

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

function buildState(status: GhStatus): DeployState {
  if (status.state === "pending") return "building"
  if (status.state !== "success") return "failed"
  return /skipped/i.test(status.description ?? "") ? "skipped" : "ready"
}

const versionOf = (json: string | null) => {
  try {
    return json ? ((JSON.parse(json) as { version?: string }).version ?? null) : null
  } catch {
    return null
  }
}

async function load(): Promise<Status> {
  const [runs, releases, commits, triggerRuns, ...configs] = await Promise.all([
    github<{ workflow_runs: GhRun[] }>("/actions/runs?per_page=25"),
    github<GhRelease[]>("/releases?per_page=60"),
    github<GhCommit[]>(`/commits?sha=main&per_page=${HISTORY}`),
    github<{ workflow_runs: GhRun[] }>(`/actions/workflows/${TRIGGER_WORKFLOW}/runs?branch=main&per_page=10`).catch(
      () => ({ workflow_runs: [] })
    ),
    ...DESKTOP.map((app) => rawFile(app.config)),
  ])
  const statusOf = (commit: GhCommit) => github<{ statuses: GhStatus[] }>(`/commits/${commit.sha}/status`)
  const statuses = await Promise.all(commits.slice(0, COMMITS).map(statusOf))
  // A project untouched by the recent commits: look further back for what it runs.
  const seen = (list: { statuses: GhStatus[] }[]) =>
    new Set(list.flatMap((item) => item.statuses.filter((s) => buildState(s) === "ready").map((s) => s.context)))
  for (let from = COMMITS; from < commits.length; from += 6) {
    const found = seen(statuses)
    if (PROJECTS.every((project) => [...found].some((context) => context.endsWith(project.project)))) break
    statuses.push(...(await Promise.all(commits.slice(from, from + 6).map(statusOf))))
  }

  const commitList: Commit[] = commits.slice(0, statuses.length).map((commit, index) => {
    const builds = (statuses[index]?.statuses ?? [])
      .filter((status) => status.context.startsWith("Vercel"))
      .map((status): Build => {
        const project = status.context.replace(/^Vercel\s*[–-]\s*/, "")
        return {
          project,
          name: PROJECTS.find((item) => item.project === project)?.name ?? project,
          state: buildState(status),
          description: status.description ?? "",
          url: status.target_url,
          updatedAt: status.updated_at,
        }
      })
      .sort((a, b) => order(a.project) - order(b.project))
    return {
      sha: commit.sha,
      message: commit.commit.message.split("\n")[0] ?? "",
      author: commit.author?.login ?? commit.commit.author?.name ?? null,
      date: commit.commit.author?.date ?? "",
      url: commit.html_url,
      builds,
    }
  })

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

  // A web app runs the newest commit Vercel built for it; skipped commits didn't change it.
  const web = PROJECTS.map((project): AppVersion => {
    const latest = commitList.flatMap((commit) =>
      commit.builds.filter((build) => build.project === project.project).map((build) => ({ commit, build }))
    )
    const live = latest.find(({ build }) => build.state === "ready")
    const newest = latest.find(({ build }) => build.state !== "skipped")
    return {
      id: project.project,
      name: project.name,
      kind: project.kind,
      version: live ? live.commit.sha.slice(0, 7) : null,
      sha: live?.commit.sha ?? null,
      date: live?.build.updatedAt ?? null,
      url: live?.build.url ?? `https://vercel.com/jornboeremas-projects/${project.project}`,
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
    commits: commitList.slice(0, COMMITS),
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
