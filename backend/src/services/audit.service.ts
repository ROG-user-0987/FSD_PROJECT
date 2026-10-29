// Audit log for admin-relevant changes (users, products, warehouses, reorder levels).
// recordAudit() must be called inside the same transaction as the change it records.
import type { Prisma } from '../generated/prisma/client.js'
import { prisma, type Tx } from '../config/prisma.js'
import { skipTake, type Page } from '../utils/http.js'
import type { AuditLogQuery } from '../validators/insights.validators.js'

export type AuditEntry = {
  userId: number
  action: string // e.g. "user.create", "product.reorderLevel.change"
  entity: string // e.g. "User"
  entityId: number | string
  before?: unknown
  after?: unknown
}

// Dates and Decimals -> plain JSON values, so they can be stored in a Json column.
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue)
}

export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: String(entry.entityId),
      before: toJson(entry.before),
      after: toJson(entry.after),
    },
  })
}

export async function listAuditLog(query: AuditLogQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.entity && { entity: query.entity }),
    ...(query.userId && { userId: query.userId }),
  }
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.auditLog.count({ where }),
  ])
  return { items, total, page: query.page, pageSize: query.pageSize } satisfies Page<unknown>
}
