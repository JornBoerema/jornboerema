import { defineConfig, type Plugin } from "vite"

/** In dev, /api/status runs the Vercel function in api/status.ts against the dev database. */
const api: Plugin = {
  name: "status-api",
  configureServer(server) {
    process.loadEnvFile?.(new URL("../../.env", import.meta.url).pathname)
    server.middlewares.use("/api/status", async (_req, res) => {
      const { GET } = await server.ssrLoadModule("/api/status.ts")
      const response: Response = await GET()
      res.statusCode = response.status
      res.setHeader("Content-Type", "application/json")
      res.end(await response.text())
    })
  },
}

export default defineConfig({ plugins: [api] })
