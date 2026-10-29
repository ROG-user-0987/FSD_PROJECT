// Stock movements: the heart of InventoryOS (correctness rules 1 to 4 and 6).
//
// Rule 1, stock never goes negative even under concurrency: a decrease is ONE
// conditional update inside the transaction,
//     updateMany({ where: { productId, warehouseId, quantity: { gte: qty } },
//                  data:  { quantity: { decrement: qty } } })
// and count === 0 means "not enough stock" -> 409 INSUFFICIENT_STOCK. There is no
// read-then-write, so two requests can never both take the last unit. An increase is an
// upsert on the unique (productId, warehouseId) pair.
//
// Rule 2, every change writes the ledger: the same transaction creates the
// InventoryTransaction row (signed quantity, frozen unit cost, balance after).
//
// Rule 3, idempotency: the public functions run inside withIdempotency().
//
// Rule 4, weighted-average cost: STOCK_IN / PURCHASE with a unit cost recompute
// Product.avgCost; every other row freezes the current avgCost (outgoing rows: that is
// the cost of goods sold). Transfers pass the cost frozen at dispatch.
//
// Rule 6, low-stock alerts: after a decrease, alert only when the quantity CROSSES the
// reorder level (before > level >= after), and a separate OUT_OF_STOCK when it reaches 0.
// Socket events are queued on `after` and sent only once the transaction commits.
//
// increaseStock / decreaseStock work on a transaction passed in, so transfer.service.ts
// can move several items atomically inside its own transaction.
import type { InventoryTransaction, TransactionType } from '../generated/prisma/client.js'
import { prisma, type Tx } from '../config/prisma.js'
import {
  emitActivity,
  emitDashboardStale,
  emitInventoryUpdated,
  emitLowStock,
  emitNotification,
} from '../socket/emit.js'
import type { AuthUser } from '../types/express.js'
import { badRequest, conflict, notFound } from '../utils/AppError.js'
import { decimal, roundMoney, weightedAverageCost, type DecimalInput } from '../utils/money.js'
import type { PostCommit } from '../utils/postCommit.js'
import type {
  AdjustInput,
  ListInventoryQuery,
  StockInInput,
  StockOutInput,
} from '../validators/stock.validators.js'
import { assertWarehouseAccess, scopedWarehouseId } from './access.service.js'
import { withIdempotency } from './idempotency.service.js'
import { notifyManagers } from './notification.service.js'

export type Movement = {
  productId: number
  warehouseId: number
  quantity: number // always positive; the direction comes from the function called
  type: TransactionType
  userId: number
  userName: string
  unitCost?: DecimalInput // receipts: incoming cost; transfers: cost frozen at dispatch
  reason?: string
  reference?: string
  transferId?: number
}

export type MovementResult = {
  transaction: InventoryTransaction
  previousQuantity: number
  newQuantity: number
  alert: 'LOW_STOCK' | 'OUT_OF_STOCK' | null
}

export type StockStatus = 'in' | 'low' | 'out'

export function stockStatus(quantity: number, reorderLevel: number): StockStatus {
  if (quantity <= 0) return 'out'
  return quantity <= reorderLevel ? 'low' : 'in'
}

const RECEIPTS: TransactionType[] = ['STOCK_IN', 'PURCHASE']

async function loadContext(tx: Tx, productId: number, warehouseId: number) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, avgCost: true, reorderLevel: true, isActive: true },
  })
  if (!product) throw notFound('Product')
  const warehouse = await tx.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, name: true, code: true, isActive: true },
  })
  if (!warehouse) throw notFound('Warehouse')
  if (!warehouse.isActive) throw badRequest(`Warehouse ${warehouse.code} is inactive`)
  return { product, warehouse }
}

type Context = Awaited<ReturnType<typeof loadContext>>

function queueEvents(
  after: PostCommit,
  { product, warehouse }: Context,
  movement: Movement,
  row: InventoryTransaction,
  previousQuantity: number,
) {
  after.add(() => {
    emitInventoryUpdated({
      productId: product.id,
      warehouseId: warehouse.id,
      previousQuantity,
      newQuantity: row.balanceAfter,
      type: row.type,
      userName: movement.userName,
    })
    emitActivity({
      transactionId: row.id,
      productId: product.id,
      productName: product.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      type: row.type,
      quantityChange: row.quantityChange,
      userName: movement.userName,
      createdAt: row.createdAt.toISOString(),
    })
    emitDashboardStale()
  })
}

export async function increaseStock(
  tx: Tx,
  movement: Movement,
  after: PostCommit,
): Promise<MovementResult> {
  const context = await loadContext(tx, movement.productId, movement.warehouseId)
  const { product } = context
  if (!product.isActive) throw badRequest(`${product.sku} is inactive and cannot be stocked`)

  let unitCost = movement.unitCost === undefined ? product.avgCost : decimal(movement.unitCost)
  if (RECEIPTS.includes(movement.type) && movement.unitCost !== undefined) {
    // Rule 4: on-hand quantity across ALL warehouses before this receipt.
    const onHand = await tx.inventory.aggregate({
      where: { productId: product.id },
      _sum: { quantity: true },
    })
    const avgCost = weightedAverageCost(
      onHand._sum.quantity ?? 0,
      product.avgCost,
      movement.quantity,
      unitCost,
    )
    await tx.product.update({ where: { id: product.id }, data: { avgCost } })
  } else {
    unitCost = movement.type === 'TRANSFER_IN' ? unitCost : product.avgCost
  }

  const inventory = await tx.inventory.upsert({
    where: {
      productId_warehouseId: { productId: product.id, warehouseId: movement.warehouseId },
    },
    create: {
      productId: product.id,
      warehouseId: movement.warehouseId,
      quantity: movement.quantity,
    },
    update: { quantity: { increment: movement.quantity } },
  })

  const row = await tx.inventoryTransaction.create({
    data: {
      productId: product.id,
      warehouseId: movement.warehouseId,
      type: movement.type,
      quantityChange: movement.quantity,
      unitCost,
      balanceAfter: inventory.quantity,
      reason: movement.reason,
      reference: movement.reference,
      transferId: movement.transferId,
      userId: movement.userId,
    },
  })
  const previousQuantity = inventory.quantity - movement.quantity
  queueEvents(after, context, movement, row, previousQuantity)
  return { transaction: row, previousQuantity, newQuantity: inventory.quantity, alert: null }
}

export async function decreaseStock(
  tx: Tx,
  movement: Movement,
  after: PostCommit,
): Promise<MovementResult> {
  const context = await loadContext(tx, movement.productId, movement.warehouseId)
  const { product, warehouse } = context
  const pair = { productId: product.id, warehouseId: warehouse.id }

  // Rule 1: the single atomic conditional update.
  const updated = await tx.inventory.updateMany({
    where: { ...pair, quantity: { gte: movement.quantity } },
    data: { quantity: { decrement: movement.quantity } },
  })
  if (updated.count === 0) {
    const current = await tx.inventory.findUnique({ where: { productId_warehouseId: pair } })
    const available = current?.quantity ?? 0
    throw conflict(
      'INSUFFICIENT_STOCK',
      `Not enough ${product.sku} in ${warehouse.code}: ${available} available, ${movement.quantity} requested`,
      { ...pair, available, requested: movement.quantity },
    )
  }

  const inventory = await tx.inventory.findUniqueOrThrow({ where: { productId_warehouseId: pair } })
  const newQuantity = inventory.quantity
  const previousQuantity = newQuantity + movement.quantity
  const unitCost = movement.unitCost === undefined ? product.avgCost : decimal(movement.unitCost)

  const row = await tx.inventoryTransaction.create({
    data: {
      ...pair,
      type: movement.type,
      quantityChange: -movement.quantity,
      unitCost,
      balanceAfter: newQuantity,
      reason: movement.reason,
      reference: movement.reference,
      transferId: movement.transferId,
      userId: movement.userId,
    },
  })
  queueEvents(after, context, movement, row, previousQuantity)

  // Rule 6: alert on the crossing only. Hitting 0 is reported as OUT_OF_STOCK.
  let alert: MovementResult['alert'] = null
  if (newQuantity === 0 && previousQuantity > 0) alert = 'OUT_OF_STOCK'
  else if (previousQuantity > product.reorderLevel && newQuantity <= product.reorderLevel) {
    alert = 'LOW_STOCK'
  }
  if (alert) {
    const notifications = await notifyManagers(tx, {
      type: alert,
      title:
        alert === 'OUT_OF_STOCK' ? `Out of stock: ${product.name}` : `Low stock: ${product.name}`,
      message:
        alert === 'OUT_OF_STOCK'
          ? `${warehouse.name} has no ${product.sku} left.`
          : `${warehouse.name} has ${newQuantity} left (reorder level ${product.reorderLevel}).`,
      data: { ...pair, quantity: newQuantity, reorderLevel: product.reorderLevel },
    })
    after.add(() => {
      emitLowStock({ ...pair, quantity: newQuantity, reorderLevel: product.reorderLevel })
      for (const notification of notifications) emitNotification(notification)
    })
  }
  return { transaction: row, previousQuantity, newQuantity, alert }
}

// ---------------------------------------------------------------- Public operations

function response(result: MovementResult) {
  return {
    transaction: result.transaction,
    previousQuantity: result.previousQuantity,
    newQuantity: result.newQuantity,
    alert: result.alert,
  }
}

export function stockIn(actor: AuthUser, input: StockInInput, key?: string) {
  assertWarehouseAccess(actor, input.warehouseId)
  return withIdempotency(
    {
      key,
      userId: actor.id,
      endpoint: 'POST /inventory/stock-in',
      payload: input,
      statusCode: 201,
    },
    async (tx, after) =>
      response(
        await increaseStock(tx, { ...input, userId: actor.id, userName: actor.name }, after),
      ),
  )
}

export function stockOut(actor: AuthUser, input: StockOutInput, key?: string) {
  assertWarehouseAccess(actor, input.warehouseId)
  return withIdempotency(
    {
      key,
      userId: actor.id,
      endpoint: 'POST /inventory/stock-out',
      payload: input,
      statusCode: 201,
    },
    async (tx, after) =>
      response(
        await decreaseStock(tx, { ...input, userId: actor.id, userName: actor.name }, after),
      ),
  )
}

// ADMIN / MANAGER only (route). Corrections are new rows, never edits of old ones.
export function adjustStock(actor: AuthUser, input: AdjustInput, key?: string) {
  return withIdempotency(
    { key, userId: actor.id, endpoint: 'POST /inventory/adjust', payload: input, statusCode: 201 },
    async (tx, after) => {
      const movement: Movement = {
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: Math.abs(input.quantityChange),
        type: 'ADJUSTMENT',
        reason: input.reason,
        userId: actor.id,
        userName: actor.name,
      }
      const result =
        input.quantityChange > 0
          ? await increaseStock(tx, movement, after)
          : await decreaseStock(tx, movement, after)
      return response(result)
    },
  )
}

// ---------------------------------------------------------------- Listing

// Rows are product x warehouse. The whole matching set is at most a few thousand rows
// (products x warehouses), so status filtering and sorting by value happen in memory,
// which keeps the query simple. Move them into SQL if the catalogue grows a lot.
export async function listInventory(actor: AuthUser, query: ListInventoryQuery) {
  const warehouseId = scopedWarehouseId(actor, query.warehouseId)
  const rows = await prisma.inventory.findMany({
    where: {
      ...(warehouseId && { warehouseId }),
      warehouse: { isActive: true },
      product: {
        isActive: true,
        ...(query.categoryId && { categoryId: query.categoryId }),
        ...(query.supplierId && { supplierId: query.supplierId }),
        ...(query.search && {
          OR: [{ name: { contains: query.search } }, { sku: { contains: query.search } }],
        }),
      },
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          reorderLevel: true,
          avgCost: true,
          category: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
      },
      warehouse: { select: { id: true, name: true, code: true } },
    },
  })

  let items = rows.map((row) => ({
    id: row.id,
    product: row.product,
    warehouse: row.warehouse,
    quantity: row.quantity,
    value: roundMoney(row.product.avgCost.mul(row.quantity)),
    stockStatus: stockStatus(row.quantity, row.product.reorderLevel),
    updatedAt: row.updatedAt,
  }))
  if (query.stockStatus) items = items.filter((item) => item.stockStatus === query.stockStatus)

  const direction = query.order === 'desc' ? -1 : 1
  items.sort((a, b) => {
    if (query.sort === 'quantity') return (a.quantity - b.quantity) * direction
    if (query.sort === 'value') return a.value.comparedTo(b.value) * direction
    return a.product.name.localeCompare(b.product.name) * direction
  })

  const start = (query.page - 1) * query.pageSize
  return {
    items: items.slice(start, start + query.pageSize),
    total: items.length,
    page: query.page,
    pageSize: query.pageSize,
  }
}
