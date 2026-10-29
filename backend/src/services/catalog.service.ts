// Categories, suppliers and products.
// - A category or supplier still used by products cannot be deleted (409 IN_USE).
// - Products with stock history are deactivated, never deleted.
// - Only ADMIN may change reorderLevel; each change is written to the audit log.
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import type { AuthUser } from '../types/express.js'
import { conflict, forbidden, notFound } from '../utils/AppError.js'
import { skipTake } from '../utils/http.js'
import { decimal, roundMoney } from '../utils/money.js'
import type {
  CategoryInput,
  ListProductsQuery,
  ListSuppliersQuery,
  ProductInput,
  ProductUpdateInput,
  SupplierInput,
  SupplierUpdateInput,
} from '../validators/catalog.validators.js'
import { recordAudit } from './audit.service.js'
import { getProductForecast } from './forecast.service.js'
import { stockStatus, type StockStatus } from './inventory.service.js'

// ---------------------------------------------------------------- Categories

export function listCategories() {
  return prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  })
}

export function createCategory(_actor: AuthUser, input: CategoryInput) {
  return prisma.$transaction((tx) => tx.category.create({ data: input }))
}

export function updateCategory(_actor: AuthUser, id: number, input: CategoryInput) {
  return prisma.$transaction(async (tx) => {
    if (!(await tx.category.findUnique({ where: { id } }))) throw notFound('Category')
    return tx.category.update({ where: { id }, data: input })
  })
}

export function deleteCategory(_actor: AuthUser, id: number) {
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    })
    if (!category) throw notFound('Category')
    if (category._count.products > 0) {
      throw conflict('IN_USE', `${category._count.products} products still use this category`)
    }
    await tx.category.delete({ where: { id } })
    return { deleted: true }
  })
}

// ---------------------------------------------------------------- Suppliers

export async function listSuppliers(query: ListSuppliersQuery) {
  const where: Prisma.SupplierWhereInput = query.search
    ? { OR: [{ name: { contains: query.search } }, { email: { contains: query.search } }] }
    : {}
  const [items, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.supplier.count({ where }),
  ])
  return { items, total, page: query.page, pageSize: query.pageSize }
}

export async function getSupplier(id: number) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      products: {
        select: { id: true, sku: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      },
    },
  })
  if (!supplier) throw notFound('Supplier')
  return supplier
}

export function createSupplier(_actor: AuthUser, input: SupplierInput) {
  return prisma.$transaction((tx) => tx.supplier.create({ data: input }))
}

export function updateSupplier(_actor: AuthUser, id: number, input: SupplierUpdateInput) {
  return prisma.$transaction(async (tx) => {
    if (!(await tx.supplier.findUnique({ where: { id } }))) throw notFound('Supplier')
    return tx.supplier.update({ where: { id }, data: input })
  })
}

export function deleteSupplier(_actor: AuthUser, id: number) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    })
    if (!supplier) throw notFound('Supplier')
    if (supplier._count.products > 0) {
      throw conflict('IN_USE', `${supplier._count.products} products still use this supplier`)
    }
    await tx.supplier.delete({ where: { id } })
    return { deleted: true }
  })
}

// ---------------------------------------------------------------- Products

const productListSelect = {
  id: true,
  sku: true,
  name: true,
  brand: true,
  imageUrl: true,
  costPrice: true,
  avgCost: true,
  sellingPrice: true,
  reorderLevel: true,
  isActive: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true, leadTimeDays: true } },
  inventory: { select: { quantity: true, warehouseId: true } },
} satisfies Prisma.ProductSelect

// Product-level status: out = nothing anywhere, low = at least one stocked warehouse is
// at or below the reorder level, in = otherwise.
function productStatus(levels: number[], reorderLevel: number): StockStatus {
  const total = levels.reduce((sum, quantity) => sum + quantity, 0)
  if (total === 0) return 'out'
  return levels.some((quantity) => stockStatus(quantity, reorderLevel) !== 'in') ? 'low' : 'in'
}

// The catalogue is small (hundreds of products), so totals, status filter and sorting by
// stock happen in memory after one query.
export async function listProducts(query: ListProductsQuery) {
  const rows = await prisma.product.findMany({
    where: {
      ...(!query.includeInactive && { isActive: true }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search } },
          { sku: { contains: query.search } },
          { brand: { contains: query.search } },
        ],
      }),
    },
    select: productListSelect,
  })

  let items = rows.map(({ inventory, ...product }) => {
    const totalQuantity = inventory.reduce((sum, row) => sum + row.quantity, 0)
    return {
      ...product,
      totalQuantity,
      warehouseCount: inventory.filter((row) => row.quantity > 0).length,
      stockValue: roundMoney(product.avgCost.mul(totalQuantity)),
      stockStatus: productStatus(
        inventory.map((row) => row.quantity),
        product.reorderLevel,
      ),
    }
  })
  if (query.stockStatus) items = items.filter((item) => item.stockStatus === query.stockStatus)

  const direction = query.order === 'desc' ? -1 : 1
  items.sort((a, b) => {
    switch (query.sort) {
      case 'sku':
        return a.sku.localeCompare(b.sku) * direction
      case 'sellingPrice':
        return a.sellingPrice.comparedTo(b.sellingPrice) * direction
      case 'totalQuantity':
        return (a.totalQuantity - b.totalQuantity) * direction
      case 'createdAt':
        return (a.createdAt.getTime() - b.createdAt.getTime()) * direction
      default:
        return a.name.localeCompare(b.name) * direction
    }
  })

  const start = (query.page - 1) * query.pageSize
  return {
    items: items.slice(start, start + query.pageSize),
    total: items.length,
    page: query.page,
    pageSize: query.pageSize,
  }
}

export async function getProduct(actor: AuthUser, id: number) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, leadTimeDays: true, email: true, phone: true } },
    },
  })
  if (!product) throw notFound('Product')

  const [warehouses, inventory, recentTransactions, inTransit] = await Promise.all([
    prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.inventory.findMany({ where: { productId: id } }),
    prisma.inventoryTransaction.findMany({
      where: {
        productId: id,
        ...(actor.role === 'EMPLOYEE' && { warehouseId: actor.warehouseId ?? -1 }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.stockTransferItem.aggregate({
      where: { productId: id, transfer: { status: 'IN_TRANSIT' } },
      _sum: { quantity: true },
    }),
  ])

  const quantities = new Map(inventory.map((row) => [row.warehouseId, row.quantity]))
  const stock = warehouses.map((warehouse) => {
    const quantity = quantities.get(warehouse.id) ?? 0
    return {
      warehouse: { id: warehouse.id, name: warehouse.name, code: warehouse.code },
      quantity,
      value: roundMoney(product.avgCost.mul(quantity)),
      stockStatus: stockStatus(quantity, product.reorderLevel),
    }
  })
  const totalQuantity = stock.reduce((sum, row) => sum + row.quantity, 0)

  // Forecasts are visible to ADMIN and MANAGER only.
  const forecast = ['ADMIN', 'MANAGER'].includes(actor.role) ? await getProductForecast(id) : null

  return {
    ...product,
    totalQuantity,
    inTransit: inTransit._sum.quantity ?? 0,
    stockValue: roundMoney(product.avgCost.mul(totalQuantity)),
    margin: product.sellingPrice.isZero()
      ? null
      : roundMoney(product.sellingPrice.sub(product.avgCost).div(product.sellingPrice).mul(100)),
    stock,
    recentTransactions,
    forecast,
  }
}

export function createProduct(actor: AuthUser, input: ProductInput) {
  if (input.reorderLevel !== 0 && actor.role !== 'ADMIN') {
    throw forbidden('Only an admin can set the reorder level')
  }
  return prisma.$transaction(async (tx) => {
    // Until the first costed receipt, the weighted-average cost starts at the list cost.
    const product = await tx.product.create({
      data: { ...input, avgCost: decimal(input.costPrice) },
    })
    await recordAudit(tx, {
      userId: actor.id,
      action: 'product.create',
      entity: 'Product',
      entityId: product.id,
      after: product,
    })
    return product
  })
}

export function updateProduct(actor: AuthUser, id: number, input: ProductUpdateInput) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } })
    if (!before) throw notFound('Product')

    const reorderChanged =
      input.reorderLevel !== undefined && input.reorderLevel !== before.reorderLevel
    if (reorderChanged && actor.role !== 'ADMIN') {
      throw forbidden('Only an admin can change the reorder level')
    }

    const product = await tx.product.update({ where: { id }, data: input })
    await recordAudit(tx, {
      userId: actor.id,
      action: reorderChanged ? 'product.reorderLevel.change' : 'product.update',
      entity: 'Product',
      entityId: id,
      before,
      after: product,
    })
    return product
  })
}

export function deleteProduct(actor: AuthUser, id: number) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true, transferItems: true } } },
    })
    if (!product) throw notFound('Product')
    if (product._count.transactions > 0 || product._count.transferItems > 0) {
      throw conflict('IN_USE', 'This product has stock history. Deactivate it instead.')
    }
    await tx.product.delete({ where: { id } })
    await recordAudit(tx, {
      userId: actor.id,
      action: 'product.delete',
      entity: 'Product',
      entityId: id,
      before: product,
    })
    return { deleted: true }
  })
}
