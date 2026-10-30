import { serve } from "@hono/node-server"
import { app } from "./app"
import { env } from "./env"

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Evido API op http://localhost:${info.port}`)
})
