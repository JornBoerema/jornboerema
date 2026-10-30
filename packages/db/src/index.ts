import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "./generated/prisma/client"

export * from "./generated/prisma/client"

const globalForPrisma = globalThis as unknown as { evidoPrisma?: PrismaClient }

function createClient() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ontbreekt.")
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  return new PrismaClient({ adapter })
}

export function getDb() {
  return (globalForPrisma.evidoPrisma ??= createClient())
}

export type Db = ReturnType<typeof getDb>
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0]
