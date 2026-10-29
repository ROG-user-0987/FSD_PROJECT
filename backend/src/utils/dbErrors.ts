import { Prisma } from '../generated/prisma/client.js'

type AdapterCause = { originalCode?: string; originalMessage?: string }

// Prisma's SQLite adapter reports a trigger abort (RAISE(ABORT, ...) in dbGuards.ts)
// as P2003 "Foreign key constraint violated". The real message is kept in
// meta.driverAdapterError.cause. Returns that message, or null for any other error.
export function triggerMessage(err: unknown): string | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null
  const meta = err.meta as { driverAdapterError?: { cause?: AdapterCause } } | undefined
  const cause = meta?.driverAdapterError?.cause
  return cause?.originalCode === 'SQLITE_CONSTRAINT_TRIGGER' ? (cause.originalMessage ?? '') : null
}
