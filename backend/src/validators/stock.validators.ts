// Inventory movements, the transaction history and transfers.
import { z } from 'zod'
import { cost, optionalId, optionalText, order, pagination, search, stockStatus } from './common.js'

const productId = z.number().int().positive()
const warehouseId = z.number().int().positive()
const quantity = z.number().int().min(1).max(1_000_000)

// ---------------------------------------------------------------- Inventory

export const listInventoryQuery = z.object({
  ...pagination,
  search, // product name or SKU
  categoryId: optionalId,
  warehouseId: optionalId,
  supplierId: optionalId,
  stockStatus: stockStatus.optional(),
  sort: z.enum(['name', 'quantity', 'value']).default('name'),
  order,
})

export const stockInBody = z.object({
  productId,
  warehouseId,
  quantity,
  type: z.enum(['STOCK_IN', 'PURCHASE', 'RETURN']).default('STOCK_IN'),
  // Incoming unit cost; updates the weighted-average cost. Omitted -> current avgCost.
  unitCost: cost.optional(),
  reason: optionalText(300),
  reference: optionalText(100),
})

export const stockOutBody = z.object({
  productId,
  warehouseId,
  quantity,
  type: z.enum(['STOCK_OUT', 'SALE']).default('STOCK_OUT'),
  reason: optionalText(300),
  reference: optionalText(100),
})

export const adjustBody = z.object({
  productId,
  warehouseId,
  // Signed: +5 found during a stock count, -3 damaged. Never 0.
  quantityChange: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, 'quantityChange cannot be 0'),
  reason: z.string().trim().min(3, 'Explain the adjustment').max(300),
})

export type ListInventoryQuery = z.infer<typeof listInventoryQuery>
export type StockInInput = z.infer<typeof stockInBody>
export type StockOutInput = z.infer<typeof stockOutBody>
export type AdjustInput = z.infer<typeof adjustBody>

// ---------------------------------------------------------------- Transactions

export const transactionType = z.enum([
  'STOCK_IN',
  'PURCHASE',
  'STOCK_OUT',
  'SALE',
  'RETURN',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
])

export const listTransactionsQuery = z.object({
  ...pagination,
  productId: optionalId,
  warehouseId: optionalId,
  userId: optionalId,
  type: transactionType.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuery>

// ---------------------------------------------------------------- Transfers

export const transferStatus = z.enum([
  'REQUESTED',
  'APPROVED',
  'IN_TRANSIT',
  'RECEIVED',
  'CANCELLED',
])

export const createTransferBody = z
  .object({
    fromWarehouseId: warehouseId,
    toWarehouseId: warehouseId,
    note: optionalText(500),
    items: z.array(z.object({ productId, quantity })).min(1).max(50),
  })
  .refine((t) => t.fromWarehouseId !== t.toWarehouseId, {
    message: 'Source and destination must be different warehouses',
    path: ['toWarehouseId'],
  })
  .refine((t) => new Set(t.items.map((item) => item.productId)).size === t.items.length, {
    message: 'Each product may appear only once',
    path: ['items'],
  })

export const listTransfersQuery = z.object({
  ...pagination,
  status: transferStatus.optional(),
  warehouseId: optionalId, // source or destination
})

export type CreateTransferInput = z.infer<typeof createTransferBody>
export type ListTransfersQuery = z.infer<typeof listTransfersQuery>
