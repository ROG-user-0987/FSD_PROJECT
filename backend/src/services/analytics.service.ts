// Dashboard KPIs and the analytics reports.
//
// Unit counts are aggregated in SQL. Money is summed with decimal.js in TypeScript,
// because SQLite stores DECIMAL as floating point and SQL SUM() could drift.
//
// Definitions:
// - valuation:   SUM(quantity * avgCost) per warehouse and per category (+ value in transit)
// - turnover:    COGS / average inventory value. COGS = SUM(units out * frozen unit cost) of
//                SALE and STOCK_OUT rows in the period. Average = (opening + closing) / 2,
//                closing = value at the end of the period, opening = closing - net movement
//                of the period at frozen costs.
// - fast-moving: most units sold per day in the window
// - slow-moving: sold something in the window, but fewer than SLOW_UNITS_PER_DAY per day
// - dead stock:  quantity > 0 and no outgoing movement for at least deadDays
// - movement:    units in vs units out per day or per week (transfers excluded company-wide,
//                because they only move stock between our own warehouses)
import { Prisma, type TransactionType } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { addDays, dayList, daysAgo, daysBetween, isoDay, startOfUtcDay } from '../utils/dates.js'
import { decimal, roundMoney, sumValue, ZERO, type Decimal } from '../utils/money.js'
import type { AnalyticsQuery } from '../validators/insights.validators.js'
import { stockStatus } from './inventory.service.js'

export type AnalyticsReport =
  'valuation' | 'turnover' | 'movement' | 'fast-moving' | 'slow-moving' | 'dead-stock'

const SLOW_UNITS_PER_DAY = 0.2
const COGS_TYPES: TransactionType[] = ['SALE', 'STOCK_OUT']
const OUTGOING_TYPES: TransactionType[] = ['SALE', 'STOCK_OUT', 'TRANSFER_OUT']

type Range = { from: Date; to: Date; fromDay: string; toDayExclusive: string; days: number }

function range(query: Pick<AnalyticsQuery, 'from' | 'to'>, defaultDays = 30): Range {
  const to = query.to ?? new Date()
  const from = query.from ?? daysAgo(defaultDays - 1, to)
  return {
    from: startOfUtcDay(from),
    to,
    fromDay: isoDay(from),
    toDayExclusive: isoDay(addDays(startOfUtcDay(to), 1)),
    days: daysBetween(from, to),
  }
}

const warehouseSql = (warehouseId?: number) =>
  warehouseId ? Prisma.sql`AND "warehouseId" = ${warehouseId}` : Prisma.empty

// ---------------------------------------------------------------- Building blocks

async function inventorySnapshot(warehouseId?: number) {
  const rows = await prisma.inventory.findMany({
    where: { ...(warehouseId && { warehouseId }), warehouse: { isActive: true } },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          reorderLevel: true,
          avgCost: true,
          isActive: true,
          category: { select: { id: true, name: true } },
        },
      },
      warehouse: { select: { id: true, name: true, code: true } },
    },
  })
  return rows.map((row) => ({ ...row, value: row.product.avgCost.mul(row.quantity) }))
}

type Snapshot = Awaited<ReturnType<typeof inventorySnapshot>>

function groupValue<K>(rows: Snapshot, key: (row: Snapshot[number]) => K) {
  const groups = new Map<K, { units: number; value: Decimal; rows: Snapshot }>()
  for (const row of rows) {
    const k = key(row)
    const group = groups.get(k) ?? { units: 0, value: ZERO, rows: [] }
    group.units += row.quantity
    group.value = group.value.add(row.value)
    group.rows.push(row)
    groups.set(k, group)
  }
  return groups
}

async function inTransitSummary(warehouseId?: number) {
  const items = await prisma.stockTransferItem.findMany({
    where: {
      transfer: {
        status: 'IN_TRANSIT',
        ...(warehouseId && {
          OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }],
        }),
      },
    },
    select: { quantity: true, unitCost: true, transferId: true },
  })
  return {
    transfers: new Set(items.map((item) => item.transferId)).size,
    units: items.reduce((sum, item) => sum + item.quantity, 0),
    value: roundMoney(
      sumValue(items.map((item) => ({ quantity: item.quantity, cost: item.unitCost ?? 0 }))),
    ),
  }
}

type RawMovement = { day: string; incoming: bigint | null; outgoing: bigint | null }

async function movementByDay(r: Range, warehouseId?: number) {
  // Company-wide, transfers only move stock between our own warehouses: leave them out.
  const transfers = warehouseId
    ? Prisma.empty
    : Prisma.sql`AND "type" NOT IN ('TRANSFER_OUT', 'TRANSFER_IN')`
  const rows = await prisma.$queryRaw<RawMovement[]>`
    SELECT substr("createdAt", 1, 10) AS day,
           SUM(CASE WHEN "quantityChange" > 0 THEN "quantityChange" ELSE 0 END) AS incoming,
           SUM(CASE WHEN "quantityChange" < 0 THEN -"quantityChange" ELSE 0 END) AS outgoing
    FROM "InventoryTransaction"
    WHERE "createdAt" >= ${r.fromDay} AND "createdAt" < ${r.toDayExclusive}
      ${transfers} ${warehouseSql(warehouseId)}
    GROUP BY day`
  const byDay = new Map(rows.map((row) => [row.day, row]))
  return dayList(r.from, r.to).map((date) => ({
    date,
    incoming: Number(byDay.get(date)?.incoming ?? 0),
    outgoing: Number(byDay.get(date)?.outgoing ?? 0),
  }))
}

type RawUnits = { productId: bigint; units: bigint }

async function unitsSoldByProduct(r: Range, warehouseId?: number) {
  const rows = await prisma.$queryRaw<RawUnits[]>`
    SELECT "productId", SUM(-"quantityChange") AS units
    FROM "InventoryTransaction"
    WHERE "type" = 'SALE' AND "createdAt" >= ${r.fromDay} AND "createdAt" < ${r.toDayExclusive}
      ${warehouseSql(warehouseId)}
    GROUP BY "productId"`
  return new Map(rows.map((row) => [Number(row.productId), Number(row.units)]))
}

async function productsById(ids: number[]) {
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      sku: true,
      name: true,
      avgCost: true,
      category: { select: { id: true, name: true } },
    },
  })
  return new Map(products.map((product) => [product.id, product]))
}

function stockByProduct(snapshot: Snapshot) {
  const stock = new Map<number, number>()
  for (const row of snapshot)
    stock.set(row.productId, (stock.get(row.productId) ?? 0) + row.quantity)
  return stock
}

// ---------------------------------------------------------------- Dashboard

export async function getDashboard() {
  const last30 = range({}, 30)
  const [snapshot, transit, totalProducts, warehouses, movement, sold, outgoing, recentActivity] =
    await Promise.all([
      inventorySnapshot(),
      inTransitSummary(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.warehouse.count({ where: { isActive: true } }),
      movementByDay(last30),
      unitsSoldByProduct(last30),
      prisma.inventoryTransaction.aggregate({
        where: { type: { in: COGS_TYPES }, createdAt: { gte: last30.from } },
        _sum: { quantityChange: true },
      }),
      prisma.inventoryTransaction.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 12,
        include: {
          product: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      }),
    ])

  const active = snapshot.filter((row) => row.product.isActive)
  const statuses = active.map((row) => stockStatus(row.quantity, row.product.reorderLevel))

  const topIds = [...sold.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const topProducts = await productsById(topIds.map(([id]) => id))
  const stock = stockByProduct(snapshot)

  const lowStock = active
    .filter((row) => stockStatus(row.quantity, row.product.reorderLevel) !== 'in')
    .sort(
      (a, b) =>
        a.quantity / Math.max(a.product.reorderLevel, 1) -
        b.quantity / Math.max(b.product.reorderLevel, 1),
    )
    .slice(0, 8)
    .map((row) => ({
      product: { id: row.product.id, sku: row.product.sku, name: row.product.name },
      warehouse: row.warehouse,
      quantity: row.quantity,
      reorderLevel: row.product.reorderLevel,
      stockStatus: stockStatus(row.quantity, row.product.reorderLevel),
    }))

  return {
    kpis: {
      totalProducts,
      totalUnits: snapshot.reduce((sum, row) => sum + row.quantity, 0),
      inventoryValue: roundMoney(snapshot.reduce((sum, row) => sum.add(row.value), ZERO)),
      lowStockCount: statuses.filter((status) => status === 'low').length,
      outOfStockCount: statuses.filter((status) => status === 'out').length,
      inTransit: transit,
      outgoingUnits30d: -(outgoing._sum.quantityChange ?? 0),
      warehouses,
    },
    charts: {
      movement,
      stockByCategory: [...groupValue(snapshot, (row) => row.product.category.name)]
        .map(([category, group]) => ({
          category,
          units: group.units,
          value: roundMoney(group.value),
        }))
        .sort((a, b) => b.value.comparedTo(a.value)),
      valueByWarehouse: [...groupValue(snapshot, (row) => row.warehouse.id)]
        .map(([, group]) => ({
          warehouse: group.rows[0]!.warehouse,
          units: group.units,
          value: roundMoney(group.value),
        }))
        .sort((a, b) => b.value.comparedTo(a.value)),
      fastMoving: topIds.map(([id, units]) => ({
        product: topProducts.get(id),
        unitsSold: units,
        perDay: Math.round((units / last30.days) * 10) / 10,
        stock: stock.get(id) ?? 0,
      })),
      lowStock,
    },
    recentActivity,
  }
}

// ---------------------------------------------------------------- Reports

async function valuation(query: AnalyticsQuery) {
  const [snapshot, transit] = await Promise.all([
    inventorySnapshot(query.warehouseId),
    inTransitSummary(query.warehouseId),
  ])
  const total = snapshot.reduce((sum, row) => sum.add(row.value), ZERO)
  const byProduct = [...groupValue(snapshot, (row) => row.productId)]
    .map(([, group]) => ({
      product: {
        id: group.rows[0]!.product.id,
        sku: group.rows[0]!.product.sku,
        name: group.rows[0]!.product.name,
      },
      units: group.units,
      value: roundMoney(group.value),
    }))
    .sort((a, b) => b.value.comparedTo(a.value))

  return {
    total: roundMoney(total),
    units: snapshot.reduce((sum, row) => sum + row.quantity, 0),
    inTransit: transit,
    byWarehouse: [...groupValue(snapshot, (row) => row.warehouse.id)]
      .map(([, group]) => ({
        warehouse: group.rows[0]!.warehouse,
        units: group.units,
        value: roundMoney(group.value),
        share: total.isZero() ? 0 : group.value.div(total).toNumber(),
      }))
      .sort((a, b) => b.value.comparedTo(a.value)),
    byCategory: [...groupValue(snapshot, (row) => row.product.category.name)]
      .map(([category, group]) => ({
        category,
        units: group.units,
        value: roundMoney(group.value),
        share: total.isZero() ? 0 : group.value.div(total).toNumber(),
      }))
      .sort((a, b) => b.value.comparedTo(a.value)),
    topProducts: byProduct.slice(0, query.limit),
  }
}

async function turnover(query: AnalyticsQuery) {
  const r = range(query)
  const where = query.warehouseId ? { warehouseId: query.warehouseId } : {}
  const [snapshot, periodRows, laterRows] = await Promise.all([
    inventorySnapshot(query.warehouseId),
    prisma.inventoryTransaction.findMany({
      where: { ...where, createdAt: { gte: r.from, lt: new Date(r.toDayExclusive) } },
      select: {
        type: true,
        quantityChange: true,
        unitCost: true,
        product: { select: { category: { select: { name: true } } } },
      },
    }),
    prisma.inventoryTransaction.findMany({
      where: { ...where, createdAt: { gte: new Date(r.toDayExclusive) } },
      select: { quantityChange: true, unitCost: true },
    }),
  ])

  const valueOf = (rows: { quantityChange: number; unitCost: Decimal }[]) =>
    rows.reduce((sum, row) => sum.add(row.unitCost.mul(row.quantityChange)), ZERO)

  const current = snapshot.reduce((sum, row) => sum.add(row.value), ZERO)
  const closing = current.sub(valueOf(laterRows))
  const opening = closing.sub(valueOf(periodRows))
  const average = opening.add(closing).div(2)
  const cogsRows = periodRows.filter((row) => COGS_TYPES.includes(row.type))
  const cogs = cogsRows.reduce((sum, row) => sum.add(row.unitCost.mul(-row.quantityChange)), ZERO)
  const ratio = average.isZero() ? null : cogs.div(average).toNumber()

  const categories = new Map<string, Decimal>()
  for (const row of cogsRows) {
    const name = row.product.category.name
    categories.set(name, (categories.get(name) ?? ZERO).add(row.unitCost.mul(-row.quantityChange)))
  }

  return {
    from: r.fromDay,
    to: isoDay(r.to),
    days: r.days,
    cogs: roundMoney(cogs),
    openingValue: roundMoney(opening),
    closingValue: roundMoney(closing),
    averageValue: roundMoney(average),
    turnover: ratio === null ? null : Math.round(ratio * 100) / 100,
    // Annualised: how many times a year the stock would turn at this pace.
    annualisedTurnover: ratio === null ? null : Math.round(((ratio * 365) / r.days) * 100) / 100,
    daysOfInventory: ratio ? Math.round(r.days / ratio) : null,
    cogsByCategory: [...categories]
      .map(([category, value]) => ({ category, cogs: roundMoney(value) }))
      .sort((a, b) => b.cogs.comparedTo(a.cogs)),
  }
}

// Monday of the ISO week of a "YYYY-MM-DD" day.
function weekStart(day: string) {
  const date = new Date(day + 'T00:00:00Z')
  const offset = (date.getUTCDay() + 6) % 7
  return isoDay(addDays(date, -offset))
}

async function movement(query: AnalyticsQuery) {
  const r = range(query)
  const daily = await movementByDay(r, query.warehouseId)
  if (query.interval === 'day') return { interval: 'day', series: daily }

  const weeks = new Map<string, { date: string; incoming: number; outgoing: number }>()
  for (const point of daily) {
    const key = weekStart(point.date)
    const week = weeks.get(key) ?? { date: key, incoming: 0, outgoing: 0 }
    week.incoming += point.incoming
    week.outgoing += point.outgoing
    weeks.set(key, week)
  }
  return { interval: 'week', series: [...weeks.values()] }
}

async function velocity(query: AnalyticsQuery, kind: 'fast' | 'slow') {
  const r = range(query)
  const [sold, snapshot] = await Promise.all([
    unitsSoldByProduct(r, query.warehouseId),
    inventorySnapshot(query.warehouseId),
  ])
  const stock = stockByProduct(snapshot)
  let rows = [...sold.entries()].map(([productId, units]) => ({
    productId,
    unitsSold: units,
    perDay: units / r.days,
  }))
  rows =
    kind === 'fast'
      ? rows.sort((a, b) => b.perDay - a.perDay)
      : rows.filter((row) => row.perDay < SLOW_UNITS_PER_DAY).sort((a, b) => a.perDay - b.perDay)
  rows = rows.slice(0, query.limit)

  const products = await productsById(rows.map((row) => row.productId))
  return {
    from: r.fromDay,
    to: isoDay(r.to),
    days: r.days,
    ...(kind === 'slow' && { thresholdPerDay: SLOW_UNITS_PER_DAY }),
    items: rows.map((row) => {
      const onHand = stock.get(row.productId) ?? 0
      return {
        product: products.get(row.productId),
        unitsSold: row.unitsSold,
        perDay: Math.round(row.perDay * 100) / 100,
        stock: onHand,
        daysOfCover: row.perDay > 0 ? Math.round(onHand / row.perDay) : null,
      }
    }),
  }
}

type RawLast = { productId: bigint; lastAt: string }

async function deadStock(query: AnalyticsQuery) {
  const cutoff = daysAgo(query.deadDays)
  const [snapshot, lastOut] = await Promise.all([
    inventorySnapshot(query.warehouseId),
    prisma.$queryRaw<RawLast[]>`
      SELECT "productId", MAX("createdAt") AS lastAt
      FROM "InventoryTransaction"
      WHERE "type" IN (${Prisma.join(OUTGOING_TYPES)}) ${warehouseSql(query.warehouseId)}
      GROUP BY "productId"`,
  ])
  const last = new Map(lastOut.map((row) => [Number(row.productId), new Date(row.lastAt)]))

  const items = [...groupValue(snapshot, (row) => row.productId)]
    .map(([productId, group]) => ({
      productId,
      group,
      lastOutgoingAt: last.get(productId) ?? null,
    }))
    .filter(
      ({ group, lastOutgoingAt }) =>
        group.units > 0 && (lastOutgoingAt === null || lastOutgoingAt < cutoff),
    )
    .map(({ productId, group, lastOutgoingAt }) => ({
      product: {
        id: productId,
        sku: group.rows[0]!.product.sku,
        name: group.rows[0]!.product.name,
        category: group.rows[0]!.product.category,
      },
      units: group.units,
      value: roundMoney(group.value),
      lastOutgoingAt,
      daysSinceOutgoing: lastOutgoingAt
        ? Math.floor((Date.now() - lastOutgoingAt.getTime()) / 86_400_000)
        : null,
    }))
    .sort((a, b) => b.value.comparedTo(a.value))

  return {
    deadDays: query.deadDays,
    totalValue: roundMoney(items.reduce((sum, item) => sum.add(item.value), decimal(0))),
    items: items.slice(0, query.limit),
    count: items.length,
  }
}

export function getAnalytics(report: AnalyticsReport, query: AnalyticsQuery) {
  switch (report) {
    case 'valuation':
      return valuation(query)
    case 'turnover':
      return turnover(query)
    case 'movement':
      return movement(query)
    case 'fast-moving':
      return velocity(query, 'fast')
    case 'slow-moving':
      return velocity(query, 'slow')
    case 'dead-stock':
      return deadStock(query)
  }
}
