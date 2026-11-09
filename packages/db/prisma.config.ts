import { config } from "dotenv"
import { defineConfig } from "prisma/config"

// One .env at the monorepo root is shared by every app and package.
config({ path: new URL("../../.env", import.meta.url).pathname, quiet: true })

// Local work runs against the Neon dev branch; production needs an explicit target.
const productionUrl = process.env.PROD_DATABASE_URL_UNPOOLED
if (process.env.DB_TARGET === "production" && !productionUrl)
  throw new Error("DB_TARGET=production needs PROD_DATABASE_URL_UNPOOLED")

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Migrations need a direct (unpooled) Neon connection.
    url:
      process.env.DB_TARGET === "production"
        ? productionUrl!
        : process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
})
