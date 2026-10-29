import type { Prisma } from '../generated/prisma/client.js'

// Dates and Decimals -> plain JSON values, so they can be stored in a Json column.
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
}
