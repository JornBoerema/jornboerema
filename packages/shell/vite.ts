import { resolve } from "node:path"
import { normalizePath, type Plugin, type UserConfig } from "vite"

const apps = resolve(import.meta.dirname, "../../apps")

/**
 * Even mailen, Even doen, Even noteren and Even plannen each import their own files as "@/…". Each such
 * import resolves inside the app it comes from; anything else belongs to `host`, the app
 * that holds the shell (apps/desktop, apps/app-web).
 */
export function appAlias(host: string): Plugin {
  // Vite names files with forward slashes on every system, also on Windows ("C:/…"),
  // so the roots are written that way too; with "\\" no importer matched there.
  const roots = ["mail-web", "todo-web", "notes-web", "plan-web", host].map((app) => normalizePath(resolve(apps, app)) + "/")
  return {
    name: "even-app-alias",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (!source.startsWith("@/")) return null
      const from = importer && normalizePath(importer)
      const root = roots.find((candidate) => from?.startsWith(candidate)) ?? roots[roots.length - 1]
      return this.resolve(resolve(root, "src", source.slice(2)), importer, { ...options, skipSelf: true })
    },
  }
}

/** One React, router, query cache and toaster for every app in the shell. */
export const shellResolve: UserConfig["resolve"] = {
  dedupe: ["react", "react-dom", "react-router", "@tanstack/react-query", "sonner"],
}
