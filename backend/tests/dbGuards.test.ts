// Database-level guarantees: foreign keys, CHECK-style triggers, append-only ledger,
// and the ledger consistency checker.
import { beforeAll, describe, expect, it } from 'vitest'
import { GUARD_TRIGGER_NAMES } from '../src/config/dbGuards.js'
import { Prisma } from '../src/generated/prisma/client.js'
import { checkConsistency } from '../src/services/consistency.service.js'
import { triggerMessage } from '../src/utils/dbErrors.js'
import { createUser, createWarehouse, prisma, setupDatabase } from './helpers.js'

let productId: number
let warehouseId: number
let userId: number

beforeAll(async () => {
  await setupDatabase()
  warehouseId = (await createWarehouse()).id
  userId = (await createUser('ADMIN')).id
  const product = await prisma.$transaction(async (tx) => {
    const category = await tx.category.create({ data: { name: `Guards ${Date.now()}` } })
    const supplier = await tx.supplier.create({
      data: { name: `Guards Supplier ${Date.now()}`, leadTimeDays: 5 },
    })
    return tx.product.create({
      data: {
        sku: `GUARD-${Date.now()}`,
        name: 'Guard test product',
        categoryId: category.id,
        supplierId: supplier.id,
        costPrice: '10.5000',
        sellingPrice: '15.00',
      },
    })
  })
  productId = product.id
})

const ledgerRow = (quantityChange: number, balanceAfter: number) => ({
  productId,
  warehouseId,
  userId,
  type: 'STOCK_IN' as const,
  quantityChange,
  balanceAfter,
  unitCost: '10.5000',
})

// The write must fail, and specifically because of a guard trigger.
async function expectGuard(write: Promise<unknown>, pattern: RegExp) {
  const error = await write.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error, 'the write should have been rejected').not.toBeNull()
  expect(triggerMessage(error)).toMatch(pattern)
}

describe('database guards', () => {
  it('all guard triggers exist', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type = 'trigger'`
    const names = rows.map((row) => row.name)
    for (const name of GUARD_TRIGGER_NAMES) expect(names).toContain(name)
  })

  it('foreign keys are enforced', async () => {
    const [row] = await prisma.$queryRaw<{ foreign_keys: bigint }[]>`PRAGMA foreign_keys`
    expect(Number(row?.foreign_keys)).toBe(1)

    const error = await prisma
      .$transaction((tx) =>
        tx.inventory.create({ data: { productId: 999_999, warehouseId, quantity: 1 } }),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      )
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2003')
    expect(triggerMessage(error)).toBeNull() // a real FK violation, not a guard
  })

  it('inventory quantity can never be negative', async () => {
    await expectGuard(
      prisma.$transaction((tx) =>
        tx.inventory.create({ data: { productId, warehouseId, quantity: -1 } }),
      ),
      /CHECK_FAILED: Inventory.quantity/,
    )
  })

  it('an employee must have a warehouse', async () => {
    await expectGuard(
      prisma.$transaction((tx) =>
        tx.user.create({
          data: {
            email: `guard-${Date.now()}@test.local`,
            name: 'x',
            role: 'EMPLOYEE',
            passwordHash: 'x',
          },
        }),
      ),
      /CHECK_FAILED: employees need/,
    )
  })

  it('ledger rows cannot be updated or deleted', async () => {
    const row = await prisma.$transaction((tx) =>
      tx.inventoryTransaction.create({ data: ledgerRow(5, 5) }),
    )
    await expectGuard(
      prisma.$transaction((tx) =>
        tx.inventoryTransaction.update({ where: { id: row.id }, data: { reason: 'edited' } }),
      ),
      /LEDGER_APPEND_ONLY/,
    )
    await expectGuard(
      prisma.$transaction((tx) => tx.inventoryTransaction.delete({ where: { id: row.id } })),
      /LEDGER_APPEND_ONLY/,
    )
  })

  it('a zero quantityChange is rejected', async () => {
    await expectGuard(
      prisma.$transaction((tx) => tx.inventoryTransaction.create({ data: ledgerRow(0, 5) })),
      /CHECK_FAILED: invalid InventoryTransaction/,
    )
  })
})

describe('consistency check', () => {
  it('reports pairs whose quantity differs from the ledger sum', async () => {
    // The ledger above holds +5 for this pair. Inventory says 7 -> mismatch.
    await prisma.$transaction((tx) =>
      tx.inventory.create({ data: { productId, warehouseId, quantity: 7 } }),
    )
    let report = await checkConsistency()
    expect(report.mismatches).toContainEqual({ productId, warehouseId, quantity: 7, ledgerSum: 5 })

    // A correcting ADJUSTMENT row of +2 makes them agree.
    await prisma.$transaction((tx) =>
      tx.inventoryTransaction.create({
        data: { ...ledgerRow(2, 7), type: 'ADJUSTMENT', reason: 'stock count' },
      }),
    )
    report = await checkConsistency()
    expect(report.mismatches.find((m) => m.productId === productId)).toBeUndefined()
  })
})
