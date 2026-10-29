// The stock ledger (read only). Employees only see their own warehouse's history.
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import type { AuthUser } from '../types/express.js'
import { skipTake } from '../utils/http.js'
import type { ListTransactionsQuery } from '../validators/stock.validators.js'
import { scopedWarehouseId } from './access.service.js'

export async function listTransactions(actor: AuthUser, query: ListTransactionsQuery) {
  const warehouseId = scopedWarehouseId(actor, query.warehouseId)
  const where: Prisma.InventoryTransactionWhereInput = {
    ...(query.productId && { productId: query.productId }),
    ...(warehouseId && { warehouseId }),
    ...(query.userId && { userId: query.userId }),
    ...(query.type && { type: query.type }),
    ...((query.from || query.to) && {
      createdAt: { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) },
    }),
  }
  const [items, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, name: true } },
      },
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.inventoryTransaction.count({ where }),
  ])
  return { items, total, page: query.page, pageSize: query.pageSize }
}
