import { config } from "dotenv"
import { defineConfig } from "prisma/config"

// One .env at the monorepo root is shared by every app and package.
config({ path: new URL("../../.env", import.meta.url).pathname, quiet: true })

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Migrations need a direct (unpooled) Neon connection.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
})
