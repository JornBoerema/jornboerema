import { resolve, sep } from "node:path"
import type { Plugin, UserConfig } from "vite"

const apps = resolve(import.meta.dirname, "../../apps")

/**
 * Even mailen, Even doen and Even noteren each import their own files as "@/…". Each such
 * import resolves inside the app it comes from; anything else belongs to `host`, the app
 * that holds the shell (apps/desktop, apps/app-web).
 */
export function appAlias(host: string): Plugin {
  const roots = ["mail-web", "todo-web", "notes-web", host].map((app) => resolve(apps, app) + sep)
  return {
    name: "even-app-alias",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (!source.startsWith("@/")) return null
      const root = roots.find((candidate) => importer?.startsWith(candidate)) ?? roots[roots.length - 1]
      return this.resolve(resolve(root, "src", source.slice(2)), importer, { ...options, skipSelf: true })
    },
  }
}

/** One React, router, query cache and toaster for every app in the shell. */
export const shellResolve: UserConfig["resolve"] = {
  dedupe: ["react", "react-dom", "react-router", "@tanstack/react-query", "sonner"],
}
