// Ledger invariant (correctness rule 2): for every (product, warehouse),
//   Inventory.quantity == SUM(InventoryTransaction.quantityChange).
// Used by GET /api/admin/consistency-check, by the seed script and by the tests.
import { prisma, type Tx } from '../config/prisma.js'

export type Mismatch = {
  productId: number
  warehouseId: number
  quantity: number // what Inventory says
  ledgerSum: number // what the ledger adds up to
}

export type ConsistencyReport = {
  ok: boolean
  checkedPairs: number
  mismatches: Mismatch[]
  checkedAt: string
}

// Integers from raw queries come back as BigInt (the adapter uses safe integers).
type RawRow = { productId: bigint; warehouseId: bigint; quantity: bigint; ledgerSum: bigint }

const toMismatch = (row: RawRow): Mismatch => ({
  productId: Number(row.productId),
  warehouseId: Number(row.warehouseId),
  quantity: Number(row.quantity),
  ledgerSum: Number(row.ledgerSum),
})

export async function checkConsistency(
  db: Tx | typeof prisma = prisma,
): Promise<ConsistencyReport> {
  // Inventory rows whose quantity differs from their ledger total...
  const inventoryMismatches = await db.$queryRaw<RawRow[]>`
    SELECT i."productId", i."warehouseId", i."quantity",
           COALESCE(SUM(t."quantityChange"), 0) AS "ledgerSum"
    FROM "Inventory" i
    LEFT JOIN "InventoryTransaction" t
      ON t."productId" = i."productId" AND t."warehouseId" = i."warehouseId"
    GROUP BY i."id"
    HAVING i."quantity" <> COALESCE(SUM(t."quantityChange"), 0)`

  // ...and ledger entries for pairs that have no Inventory row at all.
  const orphanLedger = await db.$queryRaw<RawRow[]>`
    SELECT t."productId", t."warehouseId", 0 AS "quantity",
           SUM(t."quantityChange") AS "ledgerSum"
    FROM "InventoryTransaction" t
    LEFT JOIN "Inventory" i
      ON i."productId" = t."productId" AND i."warehouseId" = t."warehouseId"
    WHERE i."id" IS NULL
    GROUP BY t."productId", t."warehouseId"
    HAVING SUM(t."quantityChange") <> 0`

  const mismatches = [...inventoryMismatches, ...orphanLedger].map(toMismatch)
  return {
    ok: mismatches.length === 0,
    checkedPairs: await db.inventory.count(),
    mismatches,
    checkedAt: new Date().toISOString(),
  }
}
