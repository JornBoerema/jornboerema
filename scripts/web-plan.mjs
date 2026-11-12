// Which web apps an update puts live, for .github/workflows/web-update.yml.
// Prints `api=<project id or nothing>` and `web=<matrix JSON>` for $GITHUB_OUTPUT.
//
//   node scripts/web-plan.mjs affected   apps changed since the previous web-v tag (all, if there is none)
//   node scripts/web-plan.mjs all
//   node scripts/web-plan.mjs @evido/mail-web,@evido/api
import { execFileSync } from "node:child_process"
import { TAG_PREFIX, WEB_APPS } from "./web-apps.mjs"

const run = (command, args, env = {}) =>
  execFileSync(command, args, { encoding: "utf8", env: { ...process.env, ...env } }).trim()

/** The update before this one: the newest web-v tag that isn't the commit itself. */
function previousTag() {
  const head = run("git", ["rev-parse", "HEAD"])
  const tags = run("git", ["tag", "--list", `${TAG_PREFIX}*`, "--merged", "HEAD", "--sort=-v:refname"])
    .split("\n")
    .filter(Boolean)
  return tags.find((tag) => run("git", ["rev-list", "-n", "1", tag]) !== head) ?? null
}

function chosen(choice) {
  if (choice === "all") return Object.keys(WEB_APPS)
  if (choice !== "affected") {
    const names = choice.split(",").map((name) => name.trim()).filter(Boolean)
    const unknown = names.filter((name) => !(name in WEB_APPS))
    if (unknown.length) throw new Error(`Not a web app: ${unknown.join(", ")}`)
    return names
  }
  const base = previousTag()
  if (!base) return Object.keys(WEB_APPS)
  console.error(`Changed since ${base}:`)
  const listed = JSON.parse(
    run("pnpm", ["-s", "turbo", "ls", "--affected", "--output=json"], {
      TURBO_SCM_BASE: base,
      TURBO_SCM_HEAD: "HEAD",
    })
  )
  return listed.packages.items.map((item) => item.name).filter((name) => name in WEB_APPS)
}

const apps = chosen(process.argv[2] ?? "affected")
console.error(apps.length ? apps.join("\n") : "nothing")
const web = apps
  .filter((name) => name !== "@evido/api")
  .map((name) => ({ package: name, project: WEB_APPS[name] }))
console.log(`api=${apps.includes("@evido/api") ? WEB_APPS["@evido/api"] : ""}`)
console.log(`web=${JSON.stringify(web)}`)
