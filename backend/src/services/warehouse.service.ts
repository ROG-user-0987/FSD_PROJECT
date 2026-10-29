// Warehouses (create/update: ADMIN only). Warehouses are deactivated, never deleted.
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import type { AuthUser } from '../types/express.js'
import { notFound } from '../utils/AppError.js'
import { roundMoney, ZERO } from '../utils/money.js'
import type {
  ListWarehousesQuery,
  WarehouseInput,
  WarehouseUpdateInput,
} from '../validators/catalog.validators.js'
import { recordAudit } from './audit.service.js'
import { stockStatus } from './inventory.service.js'

// Units, value (quantity x avgCost) and low/out counts per warehouse.
async function stockTotals(warehouseIds: number[]) {
  const rows = await prisma.inventory.findMany({
    where: { warehouseId: { in: warehouseIds }, product: { isActive: true } },
    select: {
      warehouseId: true,
      quantity: true,
      product: { select: { avgCost: true, reorderLevel: true } },
    },
  })
  const totals = new Map<
    number,
    { units: number; value: Prisma.Decimal; low: number; out: number; products: number }
  >()
  for (const row of rows) {
    const total = totals.get(row.warehouseId) ?? {
      units: 0,
      value: ZERO,
      low: 0,
      out: 0,
      products: 0,
    }
    const status = stockStatus(row.quantity, row.product.reorderLevel)
    total.units += row.quantity
    total.value = total.value.add(row.product.avgCost.mul(row.quantity))
    total.products += 1
    if (status === 'low') total.low += 1
    if (status === 'out') total.out += 1
    totals.set(row.warehouseId, total)
  }
  return (id: number) => {
    const total = totals.get(id)
    return {
      units: total?.units ?? 0,
      value: roundMoney(total?.value ?? ZERO),
      products: total?.products ?? 0,
      lowStock: total?.low ?? 0,
      outOfStock: total?.out ?? 0,
    }
  }
}

export async function listWarehouses(query: ListWarehousesQuery) {
  const where: Prisma.WarehouseWhereInput = query.includeInactive ? {} : { isActive: true }
  const warehouses = await prisma.warehouse.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { users: true, inventory: true } } },
  })
  const totals = await stockTotals(warehouses.map((warehouse) => warehouse.id))
  return warehouses.map((warehouse) => ({ ...warehouse, stock: totals(warehouse.id) }))
}

export async function getWarehouse(id: number) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true, inventory: true } },
      users: { where: { isActive: true }, select: { id: true, name: true, role: true } },
    },
  })
  if (!warehouse) throw notFound('Warehouse')
  const totals = await stockTotals([id])
  return { ...warehouse, stock: totals(id) }
}

export function createWarehouse(actor: AuthUser, input: WarehouseInput) {
  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.create({ data: input })
    await recordAudit(tx, {
      userId: actor.id,
      action: 'warehouse.create',
      entity: 'Warehouse',
      entityId: warehouse.id,
      after: warehouse,
    })
    return warehouse
  })
}

export function updateWarehouse(actor: AuthUser, id: number, input: WarehouseUpdateInput) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.warehouse.findUnique({ where: { id } })
    if (!before) throw notFound('Warehouse')
    const warehouse = await tx.warehouse.update({ where: { id }, data: input })
    await recordAudit(tx, {
      userId: actor.id,
      action: input.isActive === false ? 'warehouse.deactivate' : 'warehouse.update',
      entity: 'Warehouse',
      entityId: id,
      before,
      after: warehouse,
    })
    return warehouse
  })
}
