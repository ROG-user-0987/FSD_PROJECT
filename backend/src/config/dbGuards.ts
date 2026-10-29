// Database-level guards for rules Prisma cannot express, as SQLite triggers.
//
// Why they are re-applied on every start instead of only in a migration: when a
// later migration alters a table, Prisma's SQLite migrations rebuild it (create new
// table, copy rows, drop old), and dropping a table drops its triggers. Re-creating
// them on every server start, seed and test run means they can never silently go
// missing. A test checks that all of them exist.
//
// The API checks these rules first and returns friendly errors; the triggers are
// the last line of defence against bugs and manual SQL.
import type { PrismaClient } from '../generated/prisma/client.js'

type Rule = { name: string; table: string; valid: string; message: string }

// "valid" is the condition every row must satisfy (in effect, a CHECK constraint).
// NULL values pass, as with CHECK constraints in standard SQL.
const RULES: Rule[] = [
  {
    name: 'inventory_quantity',
    table: 'Inventory',
    valid: 'NEW.quantity >= 0',
    message: 'Inventory.quantity must be >= 0',
  },
  {
    name: 'ledger_values',
    table: 'InventoryTransaction',
    valid: 'NEW.quantityChange <> 0 AND NEW.balanceAfter >= 0 AND NEW.unitCost >= 0',
    message: 'invalid InventoryTransaction values',
  },
  {
    name: 'transfer_warehouses',
    table: 'StockTransfer',
    valid: 'NEW.fromWarehouseId <> NEW.toWarehouseId',
    message: 'a transfer needs two different warehouses',
  },
  {
    name: 'transfer_item_values',
    table: 'StockTransferItem',
    valid: 'NEW.quantity > 0 AND (NEW.unitCost IS NULL OR NEW.unitCost >= 0)',
    message: 'invalid StockTransferItem values',
  },
  {
    name: 'product_values',
    table: 'Product',
    valid:
      'NEW.costPrice >= 0 AND NEW.avgCost >= 0 AND NEW.sellingPrice >= 0 AND NEW.reorderLevel >= 0',
    message: 'product prices and reorder level must be >= 0',
  },
  {
    name: 'supplier_values',
    table: 'Supplier',
    valid: 'NEW.leadTimeDays > 0 AND (NEW.rating IS NULL OR NEW.rating BETWEEN 0 AND 5)',
    message: 'invalid Supplier values',
  },
  {
    name: 'user_warehouse',
    table: 'User',
    valid: "(NEW.role = 'EMPLOYEE') = (NEW.warehouseId IS NOT NULL)",
    message: 'employees need exactly one warehouse; other roles have none',
  },
]

type Statement = { name: string; sql: string }

function buildStatements(): Statement[] {
  const statements: Statement[] = []
  for (const rule of RULES) {
    for (const op of ['INSERT', 'UPDATE'] as const) {
      const name = `guard_${rule.name}_${op.toLowerCase()}`
      statements.push({
        name,
        sql: `CREATE TRIGGER ${name} BEFORE ${op} ON "${rule.table}" FOR EACH ROW
              WHEN NOT (${rule.valid})
              BEGIN SELECT RAISE(ABORT, 'CHECK_FAILED: ${rule.message}'); END`,
      })
    }
  }
  // Append-only ledger (correctness rule 2): history can never be edited or deleted.
  for (const op of ['UPDATE', 'DELETE'] as const) {
    const name = `ledger_append_only_${op.toLowerCase()}`
    statements.push({
      name,
      sql: `CREATE TRIGGER ${name} BEFORE ${op} ON "InventoryTransaction" FOR EACH ROW
            BEGIN SELECT RAISE(ABORT, 'LEDGER_APPEND_ONLY: inventory transactions cannot be changed or deleted'); END`,
    })
  }
  return statements
}

export const GUARD_TRIGGER_NAMES = buildStatements().map((statement) => statement.name)

// Drop and re-create, so a changed rule always takes effect. Runs in one transaction.
// The SQL is built only from the constants above (never from user input), so the
// "Unsafe" raw-query variant is safe here.
export async function applyDbGuards(prisma: PrismaClient): Promise<void> {
  const statements = buildStatements()
  await prisma.$transaction(async (tx) => {
    for (const { name, sql } of statements) {
      await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name}`)
      await tx.$executeRawUnsafe(sql)
    }
  })
}
