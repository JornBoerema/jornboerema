import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { secureHeaders } from "hono/secure-headers"
import { getAuth } from "@evido/auth/server"
import { env } from "./env"
import { accessRoutes, adminRoutes } from "./admin/routes"
import { mailRoutes } from "./mail/routes"
import { connectionRoutes } from "./connections/routes"
import { todoRoutes } from "./todo/routes"
import { handleMcp } from "./todo/mcp"

export const app = new Hono()

app.use(logger())
app.use(secureHeaders({ crossOriginResourcePolicy: false }))
app.use(
  "/api/*",
  cors({
    origin: (origin) => (env.trustedOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "Accept-Language"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    // The desktop app reads its session token from here after signing in.
    exposeHeaders: ["set-auth-token"],
    maxAge: 600,
  })
)

app.get("/health", (c) => c.json({ ok: true }))

// Better Auth: sessions, e-mail flows, OAuth provider and discovery metadata.
app.on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw))
app.get("/.well-known/*", (c) => getAuth().handler(c.req.raw))

app.get("/api/config", (c) => c.json({ realtime: env.realtimeEnabled }))
app.route("/api/mail", mailRoutes)
app.route("/api/connections", connectionRoutes)
app.route("/api/access", accessRoutes)
app.route("/api/admin", adminRoutes)
app.route("/api", todoRoutes)

app.post("/mcp", (c) => handleMcp(c.req.raw))
app.on(["GET", "DELETE"], "/mcp", (c) => c.body(null, 405, { Allow: "POST" }))
