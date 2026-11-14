import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/** Every /admin path is the admin app, and /privacy, /terms and /download are their own pages, as on Vercel. */
const adminFallback = {
  name: "admin-fallback",
  configureServer(server) {
    server.middlewares.use(rewrite)
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewrite)
  },
}

/** The plain pages, which Vercel serves without a trailing slash. */
const PAGES = ["/privacy", "/terms", "/download"]

function rewrite(req, _res, next) {
  const path = req.url?.split("?")[0] ?? ""
  if ((path === "/admin" || path.startsWith("/admin/")) && !path.includes(".")) req.url = "/admin/index.html"
  // Without this the dev server answers /privacy with the home page.
  else if (PAGES.includes(path)) req.url = `${path}/index.html`
  next()
}

// The home, privacy, terms and download pages are plain HTML; /admin is a React app.
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
        terms: resolve(import.meta.dirname, "terms/index.html"),
        download: resolve(import.meta.dirname, "download/index.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
      },
    },
  },
})
