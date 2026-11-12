import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // VITE_* variables live next to this config (apps/auth-web/.env).
  // The apps find the account site on this port while developing (see @evido/auth/client).
  server: { port: 3005, strictPort: true },
  preview: { port: 3005 },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
