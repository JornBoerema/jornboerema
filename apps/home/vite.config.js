import { resolve } from "node:path"
import { defineConfig } from "vite"

/** /privacy, /terms, /dpa and /download are their own pages, as on Vercel. */
const pages = {
  name: "pages",
  configureServer(server) {
    server.middlewares.use(rewrite)
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewrite)
  },
}

/** The plain pages, which Vercel serves without a trailing slash. */
const PAGES = ["/privacy", "/terms", "/dpa", "/download"]

function rewrite(req, _res, next) {
  const path = req.url?.split("?")[0] ?? ""
  // Without this the dev server answers /privacy with the home page.
  if (PAGES.includes(path)) req.url = `${path}/index.html`
  next()
}

// The home, privacy, terms, dpa and download pages are plain HTML. The admin lives in the web app (app.jornboerema.nl/admin).
export default defineConfig({
  plugins: [pages],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        privacy: resolve(import.meta.dirname, "privacy/index.html"),
        terms: resolve(import.meta.dirname, "terms/index.html"),
        dpa: resolve(import.meta.dirname, "dpa/index.html"),
        download: resolve(import.meta.dirname, "download/index.html"),
      },
    },
  },
})
