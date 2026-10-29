// Prisma client for SQLite (Prisma 7 + the better-sqlite3 driver adapter).
//
// IMPORTANT (SQLite + this adapter): there is ONE database connection. Interactive
// transactions take a lock, but plain queries do not. A write made outside a
// transaction while another request's transaction is open would run INSIDE that
// transaction, and be rolled back with it. Therefore:
//
//   >>> Every write in this codebase goes through prisma.$transaction(...). <<<
//
// Reads outside a transaction are fine. They may briefly see uncommitted rows of a
// transaction in progress, which is acceptable for listings and dashboards.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient, type Prisma } from '../generated/prisma/client.js'
import { applyDbGuards } from './dbGuards.js'
import { env } from './env.js'

// src/config (or dist/config) -> backend/
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// "file:./prisma/dev.db" is resolved against backend/, so the API, the seed, the tests
// and the Prisma CLI (run from backend/) always use the same file.
export function sqlitePath(url: string): string {
  const file = url.replace(/^file:/, '')
  return path.isAbsolute(file) ? file : path.resolve(backendRoot, file)
}

const adapter = new PrismaBetterSqlite3({ url: sqlitePath(env.DATABASE_URL) })
// Writes are serialized by SQLite; give queued transactions time to wait their turn.
export const prisma = new PrismaClient({
  adapter,
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
})

// The client type inside prisma.$transaction(async (tx) => ...).
export type Tx = Prisma.TransactionClient

// Connection settings and database guards. Call once before serving requests.
export async function initDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') // SQLite enforces FKs only when asked
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL') // readers do not block the writer
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000') // wait instead of failing when locked
  await applyDbGuards(prisma)
}
