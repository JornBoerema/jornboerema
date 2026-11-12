import { resolve, sep } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"

const apps = resolve(import.meta.dirname, "..")

/**
 * Even mailen, Even doen and Even noteren each import their own files as "@/…". Each such
 * import resolves inside the app it comes from; anything else is this app's.
 */
function appAlias(): Plugin {
  const roots = ["mail-web", "todo-web", "notes-web", "desktop"].map((app) => resolve(apps, app) + sep)
  return {
    name: "evido-app-alias",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (!source.startsWith("@/")) return null
      const root = roots.find((candidate) => importer?.startsWith(candidate)) ?? roots[roots.length - 1]
      return this.resolve(resolve(root, "src", source.slice(2)), importer, { ...options, skipSelf: true })
    },
  }
}

/** Where a production build talks to, whatever a local .env says; development reads apps/desktop/.env. */
const PRODUCTION = {
  VITE_API_URL: "https://api.jornboerema.nl",
  VITE_AUTH_URL: "https://auth.jornboerema.nl",
  VITE_TODO_WEB_URL: "https://todo.jornboerema.nl",
  VITE_MAIL_WEB_URL: "https://mail.jornboerema.nl",
  VITE_NOTES_WEB_URL: "https://notes.jornboerema.nl",
}
const DEVELOPMENT = {
  VITE_API_URL: "http://localhost:4000",
  VITE_AUTH_URL: "http://localhost:3005",
  VITE_TODO_WEB_URL: "http://localhost:3000",
  VITE_MAIL_WEB_URL: "http://localhost:3004",
  VITE_NOTES_WEB_URL: "http://localhost:3006",
}

// Tauri loads the dev server on a fixed port (see src-tauri/tauri.conf.json).
export default defineConfig(({ mode }) => {
  const env =
    mode === "production" ? PRODUCTION : { ...DEVELOPMENT, ...loadEnv(mode, import.meta.dirname, "VITE_") }
  return {
    plugins: [appAlias(), react(), tailwindcss()],
    clearScreen: false,
    server: { port: 1430, strictPort: true },
    envPrefix: ["VITE_", "TAURI_ENV_"],
    define: Object.fromEntries(
      Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
    ),
    // One React, router, query cache and toaster for every app.
    resolve: { dedupe: ["react", "react-dom", "react-router", "@tanstack/react-query", "sonner"] },
    // Served from disk inside the app, so one large chunk costs nothing.
    build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  }
})
