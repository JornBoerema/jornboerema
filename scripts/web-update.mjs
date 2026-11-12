// `pnpm web:update`: puts the changed web apps live.
//
// Checks the apps changed since the previous update here first (typecheck,
// tests, build), then pushes main and a new `web-vN` tag. The tag starts
// .github/workflows/web-update.yml, which builds those apps and hands them to Vercel.
//
//   pnpm web:update            check, then tag and push
//   pnpm web:update --dry-run  only check, and say what would go live
import { execFileSync } from "node:child_process"
import { TAG_PREFIX } from "./web-apps.mjs"

const dryRun = process.argv.includes("--dry-run")
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", ...options })?.trim?.() ?? ""
const show = (command, args, env = {}) =>
  execFileSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } })
const fail = (message) => {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

if (run("git", ["status", "--porcelain"])) fail("Commit or stash your changes first: an update is made from main as committed.")
if (run("git", ["branch", "--show-current"]) !== "main") fail("Updates are made from main.")
run("git", ["fetch", "--tags", "--quiet", "origin"])
if (run("git", ["rev-list", "--count", "HEAD..origin/main"]) !== "0") fail("main is behind origin/main: pull first.")

const tags = run("git", ["tag", "--list", `${TAG_PREFIX}*`, "--sort=-v:refname"]).split("\n").filter(Boolean)
const base = tags[0] ?? null
if (base && run("git", ["rev-list", "-n", "1", base]) === run("git", ["rev-parse", "HEAD"]))
  fail(`Nothing new since ${base}.`)

const plan = run("node", ["scripts/web-plan.mjs", "affected"], { stdio: ["ignore", "pipe", "ignore"] })
const api = plan.match(/^api=(.*)$/m)?.[1] ?? ""
const web = JSON.parse(plan.match(/^web=(.*)$/m)?.[1] ?? "[]")
const apps = [...(api ? ["@evido/api"] : []), ...web.map((app) => app.package)]
if (!apps.length) fail(`No web app changed since ${base}. Nothing to put live.`)

console.log(`Changed since ${base ?? "the start"}: ${apps.join(", ")}\n`)
console.log("Checking: typecheck, tests and build of everything that changed…\n")
try {
  const filter = base ? ["--affected"] : []
  show("pnpm", ["turbo", "typecheck", "test", "build", ...filter, "--output-logs=errors-only"], base ? { TURBO_SCM_BASE: base } : {})
} catch {
  fail("The checks failed, so nothing went live.")
}

const next = `${TAG_PREFIX}${(Number(base?.slice(TAG_PREFIX.length)) || 0) + 1}`
if (dryRun) {
  console.log(`\n✓ All good. ${next} would put live: ${apps.join(", ")}`)
  process.exit(0)
}
run("git", ["tag", "-a", next, "-m", `Web update ${next}: ${apps.join(", ")}`])
show("git", ["push", "--quiet", "origin", "main", next])
console.log(`\n✓ ${next} is on its way: ${apps.join(", ")}`)
console.log("  Follow it with: gh run list --workflow web-update.yml --limit 1")
