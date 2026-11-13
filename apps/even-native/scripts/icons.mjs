// Writes the Hugeicons the web apps use as SVG files into assets/hi, so the
// native app shows the same signs. Run from apps/even-native:
//   node scripts/icons.mjs            every icon named in the web apps' sources
//   node scripts/icons.mjs Foo01Icon  those, plus the ones named here
// A file is named after its icon in kebab case, without "Icon": mail-01.svg.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "../../..")
const require = createRequire(join(repo, "packages/ui/package.json"))
const icons = require("@hugeicons/core-free-icons")

const names = new Set(process.argv.slice(2))
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "target") continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.tsx?$/.test(entry)) {
      for (const match of readFileSync(path, "utf8").matchAll(/\b[A-Z][A-Za-z0-9]*Icon\b/g)) names.add(match[0])
    }
  }
}
for (const dir of ["apps/desktop/src", "apps/mail-web/src", "apps/todo-web/src", "apps/notes-web/src", "packages/ui/src"])
  walk(join(repo, dir))

const kebab = (name) =>
  name
    .replace(/Icon$/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .replace(/(\d)([A-Za-z])/g, "$1-$2")
    .toLowerCase()
const attribute = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

const out = join(here, "../assets/hi")
mkdirSync(out, { recursive: true })
let written = 0
for (const name of [...names].sort()) {
  const icon = icons[name]
  if (!Array.isArray(icon)) continue
  const body = icon
    .map(([tag, attributes]) => {
      const pairs = Object.entries(attributes)
        .filter(([key]) => key !== "key")
        // The web draws them at 1.75; the files carry that width.
        .map(([key, value]) => `${attribute(key)}="${key === "strokeWidth" ? "1.75" : value}"`)
      return `<${tag} ${pairs.join(" ")}/>`
    })
    .join("")
  writeFileSync(
    join(out, `${kebab(name)}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">${body}</svg>\n`
  )
  written += 1
}
console.log(`${written} icons in assets/hi`)
