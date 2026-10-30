// Vercel Function for the whole API. `pnpm build` bundles the app (including the
// TypeScript workspace packages and the Prisma client) into dist/app.js;
// vercel.json rewrites every path here, Hono routes on the original URL.
import { getRequestListener } from "@hono/node-server"
import { app } from "../dist/app.js"

export default getRequestListener(app.fetch)
