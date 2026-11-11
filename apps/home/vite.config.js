import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/** Every /admin path is the admin app, as vercel.json rewrites it in production. */
const adminFallback = {
  name: "admin-fallback",
  configureServer(server) {
    server.middlewares.use(rewrite)
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewrite)
  },
}

function rewrite(req, _res, next) {
  const path = req.url?.split("?")[0] ?? ""
  if ((path === "/admin" || path.startsWith("/admin/")) && !path.includes(".")) req.url = "/admin/index.html"
  next()
}

// The home, privacy and download pages are plain HTML; /admin is a React app.
export default defineConfig({
  plugins: [react(), tailwindcss(), adminFallback],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "admin/src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        privacy: resolve(import.meta.dirname, "privacy/index.html"),
        download: resolve(import.meta.dirname, "download/index.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
      },
    },
  },
})
