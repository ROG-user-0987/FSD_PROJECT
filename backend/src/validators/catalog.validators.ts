// Categories, suppliers, warehouses and products.
import { z } from 'zod'
import {
  booleanQuery,
  cost,
  optionalId,
  optionalText,
  order,
  pagination,
  price,
  search,
  stockStatus,
} from './common.js'

// ---------------------------------------------------------------- Categories

export const categoryBody = z.object({ name: z.string().trim().min(1).max(60) })
export type CategoryInput = z.infer<typeof categoryBody>

// ---------------------------------------------------------------- Suppliers

export const supplierBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  phone: optionalText(30),
  address: optionalText(300),
  leadTimeDays: z.number().int().min(1).max(365),
  rating: z
    .string()
    .regex(/^([0-4](\.\d)?|5(\.0)?)$/, 'Rating is 0.0 to 5.0')
    .optional(),
})
export const supplierUpdateBody = supplierBody.partial()
export const listSuppliersQuery = z.object({ ...pagination, search })

export type SupplierInput = z.infer<typeof supplierBody>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateBody>
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuery>

// ---------------------------------------------------------------- Warehouses

export const warehouseBody = z.object({
  name: z.string().trim().min(1).max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Code is 2-10 letters or digits'),
  city: z.string().trim().min(1).max(80),
  address: optionalText(300),
})
export const warehouseUpdateBody = warehouseBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' })
export const listWarehousesQuery = z.object({ includeInactive: booleanQuery.optional() })

export type WarehouseInput = z.infer<typeof warehouseBody>
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateBody>
export type ListWarehousesQuery = z.infer<typeof listWarehousesQuery>

// ---------------------------------------------------------------- Products

export const productBody = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,32}$/, 'SKU is 3-32 letters, digits or dashes'),
  name: z.string().trim().min(1).max(160),
  description: optionalText(2000),
  categoryId: z.number().int().positive(),
  brand: optionalText(80),
  supplierId: z.number().int().positive(),
  costPrice: cost,
  sellingPrice: price,
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  imageUrl: z.url().max(500).optional(),
})
export const productUpdateBody = productBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' })

export const listProductsQuery = z.object({
  ...pagination,
  search, // name or SKU
  categoryId: optionalId,
  supplierId: optionalId,
  stockStatus: stockStatus.optional(),
  includeInactive: booleanQuery.optional(),
  sort: z.enum(['name', 'sku', 'sellingPrice', 'totalQuantity', 'createdAt']).default('name'),
  order,
})

export type ProductInput = z.infer<typeof productBody>
export type ProductUpdateInput = z.infer<typeof productUpdateBody>
export type ListProductsQuery = z.infer<typeof listProductsQuery>
