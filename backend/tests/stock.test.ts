// Correctness rules 1-6, end to end through the HTTP API.
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkConsistency } from '../src/services/consistency.service.js'
import {
  api,
  bearer,
  createProduct,
  createWarehouse,
  loginAs,
  prisma,
  setupDatabase,
  stockOf,
} from './helpers.js'

let manager: Awaited<ReturnType<typeof loginAs>>
let admin: Awaited<ReturnType<typeof loginAs>>

beforeAll(async () => {
  await setupDatabase()
  manager = await loginAs('MANAGER')
  admin = await loginAs('ADMIN')
})

const stockIn = (token: string, body: Record<string, unknown>, key?: string) => {
  const request = api().post('/api/inventory/stock-in').set(bearer(token))
  if (key) request.set('Idempotency-Key', key)
  return request.send(body)
}
const stockOut = (token: string, body: Record<string, unknown>) =>
  api().post('/api/inventory/stock-out').set(bearer(token)).send(body)

describe('rule 1: stock never goes negative under concurrency', () => {
  it('stock 10, 50 parallel stock-outs of 1: exactly 10 succeed', async () => {
    const product = await createProduct()
    const warehouse = await createWarehouse()
    const pair = { productId: product.id, warehouseId: warehouse.id }
    expect((await stockIn(manager.token, { ...pair, quantity: 10, unitCost: '50' })).status).toBe(
      201,
    )

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        stockOut(manager.token, { ...pair, quantity: 1, type: 'SALE' }),
      ),
    )
    const ok = results.filter((res) => res.status === 201)
    const rejected = results.filter((res) => res.status === 409)
    expect(ok).toHaveLength(10)
    expect(rejected).toHaveLength(40)
    for (const res of rejected) expect(res.body.error.code).toBe('INSUFFICIENT_STOCK')

    expect(await stockOf(product.id, warehouse.id)).toBe(0)
    const ledger = await prisma.inventoryTransaction.aggregate({
      where: pair,
      _sum: { quantityChange: true },
    })
    expect(ledger._sum.quantityChange).toBe(0)
  })
})

describe('rule 3: idempotency', () => {
  it('the same request with the same key 20 times creates exactly one transaction', async () => {
    const product = await createProduct()
    const warehouse = await createWarehouse()
    const body = { productId: product.id, warehouseId: warehouse.id, quantity: 3, unitCost: '20' }
    const key = `test-${randomUUID()}`

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => stockIn(manager.token, body, key)),
    )
    for (const res of responses) expect(res.status).toBe(201)
    const ids = new Set(responses.map((res) => res.body.data.transaction.id))
    expect(ids.size).toBe(1)

    expect(await stockOf(product.id, warehouse.id)).toBe(3)
    expect(await prisma.inventoryTransaction.count({ where: { productId: product.id } })).toBe(1)
  })

  it('the same key with a different body returns 422 and changes nothing', async () => {
    const product = await createProduct()
    const warehouse = await createWarehouse()
    const key = `test-${randomUUID()}`
    const body = { productId: product.id, warehouseId: warehouse.id, quantity: 2 }
    expect((await stockIn(manager.token, body, key)).status).toBe(201)
    const reused = await stockIn(manager.token, { ...body, quantity: 5 }, key)
    expect(reused.status).toBe(422)
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await stockOf(product.id, warehouse.id)).toBe(2)
  })
})

describe('rule 4: weighted-average cost and valuation', () => {
  it('matches hand-computed costs', async () => {
    const product = await createProduct({ costPrice: '90.0000' })
    const warehouse = await createWarehouse()
    const pair = { productId: product.id, warehouseId: warehouse.id }

    await stockIn(manager.token, { ...pair, quantity: 10, unitCost: '100' }) // avg 100
    await stockIn(manager.token, { ...pair, quantity: 10, unitCost: '200' }) // (10*100 + 10*200) / 20 = 150
    let current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(current.avgCost.toFixed(4)).toBe('150.0000')

    // Outgoing rows freeze the current average as their cost (COGS).
    const out = await stockOut(manager.token, { ...pair, quantity: 5, type: 'SALE' })
    expect(Number(out.body.data.transaction.unitCost)).toBe(150)

    await stockIn(manager.token, { ...pair, quantity: 5, unitCost: '300' }) // (15*150 + 5*300) / 20 = 187.5
    current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(current.avgCost.toFixed(4)).toBe('187.5000')

    // A return enters at the average cost and leaves it unchanged.
    await api()
      .post('/api/inventory/stock-in')
      .set(bearer(manager.token))
      .send({ ...pair, quantity: 1, type: 'RETURN' })
    current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(current.avgCost.toFixed(4)).toBe('187.5000')

    // Valuation = quantity x avgCost = 21 x 187.5
    const valuation = await api()
      .get(`/api/analytics/valuation?warehouseId=${warehouse.id}`)
      .set(bearer(manager.token))
    expect(valuation.status).toBe(200)
    expect(valuation.body.data.total).toBe('3937.5')
  })

  it('rounds the average to 4 decimals', async () => {
    const product = await createProduct({ costPrice: '0' })
    const warehouse = await createWarehouse()
    const pair = { productId: product.id, warehouseId: warehouse.id }
    await stockIn(manager.token, { ...pair, quantity: 3, unitCost: '10' })
    await stockIn(manager.token, { ...pair, quantity: 3, unitCost: '10.0001' })
    const current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(current.avgCost.toFixed(4)).toBe('10.0001') // 10.00005 rounds half up
  })
})

describe('rule 5: transfer lifecycle', () => {
  it('moves stock only on dispatch and receive, atomically', async () => {
    const [from, to] = [await createWarehouse(), await createWarehouse()]
    const [p1, p2] = [await createProduct(), await createProduct()]
    await stockIn(manager.token, {
      productId: p1.id,
      warehouseId: from.id,
      quantity: 5,
      unitCost: '10',
    })
    await stockIn(manager.token, {
      productId: p2.id,
      warehouseId: from.id,
      quantity: 1,
      unitCost: '20',
    })
    const auth = bearer(manager.token)

    const created = await api()
      .post('/api/transfers')
      .set(auth)
      .send({
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        items: [
          { productId: p1.id, quantity: 3 },
          { productId: p2.id, quantity: 2 },
        ],
      })
    expect(created.status).toBe(201)
    const id = created.body.data.id as number
    expect(created.body.data.status).toBe('REQUESTED')

    // Cannot skip approval.
    expect((await api().put(`/api/transfers/${id}/dispatch`).set(auth)).status).toBe(409)

    const approved = await api().put(`/api/transfers/${id}/approve`).set(auth)
    expect(approved.body.data.status).toBe('APPROVED')
    expect(approved.body.data.warnings).toHaveLength(1) // p2 is short

    // p2 lacks stock: the WHOLE dispatch fails, p1 does not move either.
    const failed = await api().put(`/api/transfers/${id}/dispatch`).set(auth)
    expect(failed.status).toBe(409)
    expect(failed.body.error.code).toBe('INSUFFICIENT_STOCK')
    expect(await stockOf(p1.id, from.id)).toBe(5)
    expect((await prisma.stockTransfer.findUniqueOrThrow({ where: { id } })).status).toBe(
      'APPROVED',
    )

    await stockIn(manager.token, { productId: p2.id, warehouseId: from.id, quantity: 5 })
    const dispatched = await api().put(`/api/transfers/${id}/dispatch`).set(auth)
    expect(dispatched.body.data.status).toBe('IN_TRANSIT')
    expect(await stockOf(p1.id, from.id)).toBe(2)
    expect(await stockOf(p1.id, to.id)).toBe(0) // in transit belongs to no warehouse

    expect((await api().put(`/api/transfers/${id}/cancel`).set(auth)).status).toBe(409)

    const received = await api().put(`/api/transfers/${id}/receive`).set(auth)
    expect(received.body.data.status).toBe('RECEIVED')
    expect(await stockOf(p1.id, to.id)).toBe(3)
    expect(await stockOf(p2.id, to.id)).toBe(2)

    // Both legs use the cost frozen at dispatch; avgCost is unchanged.
    const legs = await prisma.inventoryTransaction.findMany({
      where: { transferId: id, productId: p1.id },
    })
    expect(legs.map((leg) => leg.type).sort()).toEqual(['TRANSFER_IN', 'TRANSFER_OUT'])
    expect(new Set(legs.map((leg) => leg.unitCost.toFixed(4))).size).toBe(1)
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: p1.id } })).avgCost.toFixed(4),
    ).toBe('10.0000')
  })

  it('cancel works only before dispatch', async () => {
    const [from, to] = [await createWarehouse(), await createWarehouse()]
    const product = await createProduct()
    const created = await api()
      .post('/api/transfers')
      .set(bearer(manager.token))
      .send({
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        items: [{ productId: product.id, quantity: 1 }],
      })
    const cancelled = await api()
      .put(`/api/transfers/${created.body.data.id}/cancel`)
      .set(bearer(manager.token))
    expect(cancelled.body.data.status).toBe('CANCELLED')
    expect(
      (await api().put(`/api/transfers/${created.body.data.id}/approve`).set(bearer(manager.token)))
        .status,
    ).toBe(409)
  })

  it('employees only act on their own warehouse', async () => {
    const employee = await loginAs('EMPLOYEE')
    const own = employee.user.warehouseId!
    const other = (await createWarehouse()).id
    const product = await createProduct()
    const auth = bearer(employee.token)

    const foreign = await api()
      .post('/api/transfers')
      .set(auth)
      .send({
        fromWarehouseId: other,
        toWarehouseId: own,
        items: [{ productId: product.id, quantity: 1 }],
      })
    expect(foreign.status).toBe(403)

    // A manager's transfer INTO the employee's warehouse: the employee may receive, not dispatch.
    await stockIn(manager.token, { productId: product.id, warehouseId: other, quantity: 2 })
    const created = await api()
      .post('/api/transfers')
      .set(bearer(manager.token))
      .send({
        fromWarehouseId: other,
        toWarehouseId: own,
        items: [{ productId: product.id, quantity: 2 }],
      })
    const id = created.body.data.id
    expect((await api().put(`/api/transfers/${id}/approve`).set(auth)).status).toBe(403)
    await api().put(`/api/transfers/${id}/approve`).set(bearer(manager.token))
    expect((await api().put(`/api/transfers/${id}/dispatch`).set(auth)).status).toBe(403)
    await api().put(`/api/transfers/${id}/dispatch`).set(bearer(manager.token))
    const received = await api().put(`/api/transfers/${id}/receive`).set(auth)
    expect(received.status).toBe(200)
    expect(await stockOf(product.id, own)).toBe(2)
  })
})

describe('rule 6: low-stock alerts', () => {
  it('alerts only when crossing the reorder level, and separately at zero', async () => {
    const product = await createProduct({ reorderLevel: 5 })
    const warehouse = await createWarehouse()
    const pair = { productId: product.id, warehouseId: warehouse.id }
    await stockIn(manager.token, { ...pair, quantity: 8 })

    const alerts = async (type: 'LOW_STOCK' | 'OUT_OF_STOCK') =>
      (await prisma.notification.findMany({ where: { type, userId: admin.user.id } })).filter(
        (n) => (n.data as { productId?: number } | null)?.productId === product.id,
      ).length

    const out = (quantity: number) => stockOut(manager.token, { ...pair, quantity })
    expect((await out(2)).body.data.alert).toBeNull() // 8 -> 6
    expect((await out(1)).body.data.alert).toBe('LOW_STOCK') // 6 -> 5: crossing
    expect((await out(1)).body.data.alert).toBeNull() // 5 -> 4: already low
    expect(await alerts('LOW_STOCK')).toBe(1)
    expect((await out(4)).body.data.alert).toBe('OUT_OF_STOCK') // 4 -> 0
    expect(await alerts('OUT_OF_STOCK')).toBe(1)
  })
})

describe('rule 2: the ledger stays consistent', () => {
  it('after a random mix of stock in/out, adjustments and transfers', async () => {
    const warehouses = [await createWarehouse(), await createWarehouse(), await createWarehouse()]
    const products = [await createProduct(), await createProduct(), await createProduct()]
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!

    for (let i = 0; i < 60; i++) {
      const pair = { productId: pick(products).id, warehouseId: pick(warehouses).id }
      const roll = random()
      if (roll < 0.4)
        await stockIn(manager.token, {
          ...pair,
          quantity: 1 + Math.floor(random() * 10),
          unitCost: '12.5',
        })
      else if (roll < 0.75)
        await stockOut(manager.token, { ...pair, quantity: 1 + Math.floor(random() * 6) })
      else if (roll < 0.85) {
        await api()
          .post('/api/inventory/adjust')
          .set(bearer(manager.token))
          .send({ ...pair, quantityChange: random() < 0.5 ? -1 : 2, reason: 'cycle count' })
      } else {
        const to = pick(warehouses.filter((w) => w.id !== pair.warehouseId))
        const created = await api()
          .post('/api/transfers')
          .set(bearer(manager.token))
          .send({
            fromWarehouseId: pair.warehouseId,
            toWarehouseId: to.id,
            items: [{ productId: pair.productId, quantity: 1 }],
          })
        for (const action of ['approve', 'dispatch', 'receive']) {
          await api()
            .put(`/api/transfers/${created.body.data.id}/${action}`)
            .set(bearer(manager.token))
        }
      }
    }

    const report = await checkConsistency()
    expect(report.mismatches).toEqual([])
    expect(report.ok).toBe(true)
  })
})

describe('employees only see their own warehouse', () => {
  it('inventory and transaction lists are scoped; other warehouses are forbidden', async () => {
    const employee = await loginAs('EMPLOYEE')
    const own = employee.user.warehouseId!
    const other = (await createWarehouse()).id
    const product = await createProduct()
    await stockIn(manager.token, { productId: product.id, warehouseId: own, quantity: 4 })
    await stockIn(manager.token, { productId: product.id, warehouseId: other, quantity: 4 })
    const auth = bearer(employee.token)

    const inventory = await api().get(`/api/inventory?warehouseId=${other}&pageSize=200`).set(auth)
    expect(inventory.status).toBe(200)
    expect(
      new Set(inventory.body.data.map((row: { warehouse: { id: number } }) => row.warehouse.id)),
    ).toEqual(new Set([own]))

    const history = await api().get(`/api/transactions?productId=${product.id}`).set(auth)
    expect(history.body.data.every((row: { warehouseId: number }) => row.warehouseId === own)).toBe(
      true,
    )

    expect(
      (await stockIn(employee.token, { productId: product.id, warehouseId: other, quantity: 1 }))
        .status,
    ).toBe(403)
    expect(
      (await stockIn(employee.token, { productId: product.id, warehouseId: own, quantity: 1 }))
        .status,
    ).toBe(201)
  })
})

describe('reorder level changes', () => {
  it('only an admin may change it, and it is audited', async () => {
    const product = await createProduct({ reorderLevel: 3 })
    const byManager = await api()
      .put(`/api/products/${product.id}`)
      .set(bearer(manager.token))
      .send({ reorderLevel: 9 })
    expect(byManager.status).toBe(403)
    const byAdmin = await api()
      .put(`/api/products/${product.id}`)
      .set(bearer(admin.token))
      .send({ reorderLevel: 9 })
    expect(byAdmin.status).toBe(200)
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'product.reorderLevel.change', entityId: String(product.id) },
    })
    expect(audit?.userId).toBe(admin.user.id)
  })
})
