// Shared test helpers: the app, test users, login.
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { initDatabase, prisma } from '../src/config/prisma.js'
import type { Role } from '../src/generated/prisma/client.js'

// Safety net: never run tests against a real database.
if (!env.DATABASE_URL.includes('test')) {
  throw new Error(`Refusing to run tests against ${env.DATABASE_URL}`)
}

export const app = createApp()
export const api = () => request(app)
export { prisma }

export const PASSWORD = 'Test-Password-123'
// Low bcrypt cost keeps tests fast; bcrypt.compare works with any cost.
const passwordHash = bcrypt.hashSync(PASSWORD, 4)

let initialised = false
export async function setupDatabase() {
  if (!initialised) await initDatabase()
  initialised = true
}

const unique = () => randomUUID().slice(0, 8).toUpperCase()

export function createWarehouse() {
  const id = unique()
  return prisma.$transaction((tx) =>
    tx.warehouse.create({ data: { name: `Warehouse ${id}`, code: id, city: 'Test City' } }),
  )
}

export async function createUser(role: Role, overrides: { isActive?: boolean } = {}) {
  const warehouseId = role === 'EMPLOYEE' ? (await createWarehouse()).id : null
  return prisma.$transaction((tx) =>
    tx.user.create({
      data: {
        email: `${role.toLowerCase()}-${unique().toLowerCase()}@test.local`,
        name: `Test ${role}`,
        role,
        warehouseId,
        passwordHash,
        isActive: overrides.isActive ?? true,
      },
    }),
  )
}

export function refreshCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
  return cookies.find((c) => c.startsWith('inventoryos_rt='))?.split(';')[0]
}

export async function loginAs(role: Role) {
  const user = await createUser(role)
  const res = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD })
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`)
  return {
    user,
    token: res.body.data.accessToken as string,
    cookie: refreshCookie(res),
  }
}

export async function createProduct(options: { reorderLevel?: number; costPrice?: string } = {}) {
  const id = unique()
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.create({ data: { name: `Category ${id}` } })
    const supplier = await tx.supplier.create({ data: { name: `Supplier ${id}`, leadTimeDays: 5 } })
    const costPrice = options.costPrice ?? '100.0000'
    return tx.product.create({
      data: {
        sku: `SKU-${id}`,
        name: `Product ${id}`,
        categoryId: category.id,
        supplierId: supplier.id,
        costPrice,
        avgCost: costPrice,
        sellingPrice: '150.00',
        reorderLevel: options.reorderLevel ?? 0,
      },
    })
  })
}

// Bearer header for supertest's .set()
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function stockOf(productId: number, warehouseId: number) {
  const row = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  })
  return row?.quantity ?? 0
}
