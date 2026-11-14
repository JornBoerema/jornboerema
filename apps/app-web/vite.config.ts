import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { appAlias, shellResolve } from "../../packages/shell/vite"

/** Where a production build talks to, whatever a local .env says; development reads apps/app-web/.env. */
const PRODUCTION = { VITE_API_URL: "https://api.jornboerema.nl" }
const DEVELOPMENT = { VITE_API_URL: "http://localhost:4000" }

// Even mailen, Even doen and Even noteren in one page; each is built from its own source next door.
export default defineConfig(({ mode }) => {
  const env =
    mode === "production" ? PRODUCTION : { ...DEVELOPMENT, ...loadEnv(mode, import.meta.dirname, "VITE_") }
  return {
    plugins: [appAlias("app-web"), react(), tailwindcss()],
    server: { port: 3007, strictPort: true },
    preview: { port: 3007 },
    define: Object.fromEntries(
      Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
    ),
    resolve: shellResolve,
    build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  }
})
