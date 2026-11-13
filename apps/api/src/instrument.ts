// Loaded before anything else in app.ts, so errors while starting are reported too.
// IMPORTANT: import from `@sentry/hono/node`, not `@sentry/node`.
import * as Sentry from "@sentry/hono/node"

const dsn = process.env.SENTRY_DSN
const production = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"

// Off without a DSN: nothing is sent and every Sentry call does nothing.
if (dsn)
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? (production ? "production" : "development"),
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // One in ten requests is traced in production; every one while developing.
    tracesSampleRate: production ? 0.1 : 1.0,
    // This API handles people's mail. An error report says where it went wrong,
    // never who it was or what their mail, search or prompt said.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  })
