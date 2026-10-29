// Forecasts (written nightly by backend/forecasting/forecast.py) + reorder recommendations.
//
// Inputs for the reorder formula (reorder.service.ts):
// - forecastDaily: the latest Forecast row's predictions from today onwards
// - recentDailyDemand: units sold per day over the last 56 full days, WITHOUT censored
//   days. A day is censored when the product had no stock at the end of it: customers
//   may have wanted more than was sold, so that day says nothing about real demand.
//   End-of-day stock is rebuilt by walking the ledger backwards from today's stock.
// - onHand (all warehouses) and inTransit, supplier lead time.
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { notFound } from '../utils/AppError.js'
import { addDays, dayList, daysAgo, isoDay } from '../utils/dates.js'
import type { ListForecastsQuery } from '../validators/insights.validators.js'
import { calculateReorder, type ReorderResult, type Urgency } from './reorder.service.js'

const RECENT_DAYS = 56
const HISTORY_DAYS = 90

type DayMap = Map<number, Map<string, number>>
type RawDaily = { productId: bigint; day: string; value: bigint }

async function dailyByProduct(kind: 'sales' | 'net', fromDay: string, productId?: number) {
  const onlyProduct = productId ? Prisma.sql`AND "productId" = ${productId}` : Prisma.empty
  const rows =
    kind === 'sales'
      ? await prisma.$queryRaw<RawDaily[]>`
          SELECT "productId", substr("createdAt", 1, 10) AS day, SUM(-"quantityChange") AS value
          FROM "InventoryTransaction"
          WHERE "type" = 'SALE' AND "createdAt" >= ${fromDay} ${onlyProduct}
          GROUP BY "productId", day`
      : await prisma.$queryRaw<RawDaily[]>`
          SELECT "productId", substr("createdAt", 1, 10) AS day, SUM("quantityChange") AS value
          FROM "InventoryTransaction"
          WHERE "createdAt" >= ${fromDay} ${onlyProduct}
          GROUP BY "productId", day`
  const map: DayMap = new Map()
  for (const row of rows) {
    const id = Number(row.productId)
    if (!map.has(id)) map.set(id, new Map())
    map.get(id)!.set(row.day, Number(row.value))
  }
  return map
}

// End-of-day stock for each day in `days` (ascending, ending yesterday), rebuilt from
// today's stock by undoing each later day's net movement.
function endOfDayStock(days: string[], today: string, stockNow: number, net: Map<string, number>) {
  const stock = new Map<string, number>()
  let level = stockNow - (net.get(today) ?? 0)
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i]!
    stock.set(day, level)
    level -= net.get(day) ?? 0
  }
  return stock
}

type ForecastRow = Prisma.ForecastGetPayload<object>
type ForecastPoint = { date: string; qty: number }

function forecastPoints(forecast: ForecastRow | undefined, today: string): ForecastPoint[] {
  if (!forecast || !Array.isArray(forecast.predictedDaily)) return []
  return (forecast.predictedDaily as ForecastPoint[]).filter((point) => point.date >= today)
}

function accuracy(forecast: ForecastRow | undefined) {
  if (!forecast) return null
  return {
    modelName: forecast.modelName,
    wape: forecast.wape,
    baselineWape: forecast.baselineWape,
    // Positive = the chosen model beats the seasonal-naive baseline by that much.
    improvement:
      forecast.wape !== null && forecast.baselineWape !== null && forecast.baselineWape > 0
        ? (forecast.baselineWape - forecast.wape) / forecast.baselineWape
        : null,
    trainingDays: forecast.trainingDays,
    horizonDays: forecast.horizonDays,
    predictedTotal: forecast.predictedTotal,
    generatedAt: forecast.generatedAt,
  }
}

type Inputs = {
  sales: DayMap
  net: DayMap
  stock: Map<number, number>
  transit: Map<number, number>
  forecasts: Map<number, ForecastRow>
  days: string[]
  today: string
}

async function loadInputs(productId?: number): Promise<Inputs> {
  const now = new Date()
  const today = isoDay(now)
  const days = dayList(daysAgo(RECENT_DAYS, now), addDays(daysAgo(0, now), -1))
  const fromDay = days[0]!
  const productFilter = productId ? { productId } : {}

  const [sales, net, stockRows, transitRows, forecastRows] = await Promise.all([
    dailyByProduct('sales', fromDay, productId),
    dailyByProduct('net', fromDay, productId),
    prisma.inventory.groupBy({ by: ['productId'], where: productFilter, _sum: { quantity: true } }),
    prisma.stockTransferItem.groupBy({
      by: ['productId'],
      where: { ...productFilter, transfer: { status: 'IN_TRANSIT' } },
      _sum: { quantity: true },
    }),
    prisma.forecast.findMany({
      where: productFilter,
      orderBy: { generatedAt: 'desc' },
      distinct: ['productId'],
    }),
  ])
  return {
    sales,
    net,
    stock: new Map(stockRows.map((row) => [row.productId, row._sum.quantity ?? 0])),
    transit: new Map(transitRows.map((row) => [row.productId, row._sum.quantity ?? 0])),
    forecasts: new Map(forecastRows.map((row) => [row.productId, row])),
    days,
    today,
  }
}

function recommend(inputs: Inputs, productId: number, leadTimeDays: number): ReorderResult {
  const onHand = inputs.stock.get(productId) ?? 0
  const sales = inputs.sales.get(productId) ?? new Map<string, number>()
  const endStock = endOfDayStock(
    inputs.days,
    inputs.today,
    onHand,
    inputs.net.get(productId) ?? new Map(),
  )
  const recentDailyDemand = inputs.days
    .filter((day) => (endStock.get(day) ?? 0) > 0)
    .map((day) => sales.get(day) ?? 0)
  const points = forecastPoints(inputs.forecasts.get(productId), inputs.today)
  return calculateReorder({
    forecastDaily: points.length > 0 ? points.map((point) => point.qty) : null,
    recentDailyDemand,
    leadTimeDays,
    onHand,
    inTransit: inputs.transit.get(productId) ?? 0,
  })
}

const URGENCY_ORDER: Record<Urgency, number> = { ORDER_NOW: 0, SOON: 1, OK: 2 }

export async function listForecasts(query: ListForecastsQuery) {
  const [products, inputs] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, ...(query.categoryId && { categoryId: query.categoryId }) },
      select: {
        id: true,
        sku: true,
        name: true,
        reorderLevel: true,
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true, leadTimeDays: true } },
      },
    }),
    loadInputs(),
  ])

  const all = products.map((product) => ({
    product,
    accuracy: accuracy(inputs.forecasts.get(product.id)),
    recommendation: recommend(inputs, product.id, product.supplier.leadTimeDays),
  }))

  const summary = {
    ORDER_NOW: all.filter((row) => row.recommendation.urgency === 'ORDER_NOW').length,
    SOON: all.filter((row) => row.recommendation.urgency === 'SOON').length,
    OK: all.filter((row) => row.recommendation.urgency === 'OK').length,
    withoutForecast: all.filter((row) => row.accuracy === null).length,
    lastRunAt:
      [...inputs.forecasts.values()]
        .map((forecast) => forecast.generatedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
  }

  const items = all
    .filter((row) => !query.urgency || row.recommendation.urgency === query.urgency)
    .sort(
      (a, b) =>
        URGENCY_ORDER[a.recommendation.urgency] - URGENCY_ORDER[b.recommendation.urgency] ||
        b.recommendation.recommendedQty - a.recommendation.recommendedQty ||
        a.product.name.localeCompare(b.product.name),
    )

  const start = (query.page - 1) * query.pageSize
  return {
    items: items.slice(start, start + query.pageSize),
    total: items.length,
    page: query.page,
    pageSize: query.pageSize,
    summary,
  }
}

export async function getProductForecast(productId: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sku: true,
      name: true,
      supplier: { select: { id: true, name: true, leadTimeDays: true } },
    },
  })
  if (!product) throw notFound('Product')

  const inputs = await loadInputs(productId)
  const now = new Date()
  const historyDays = dayList(daysAgo(HISTORY_DAYS, now), addDays(daysAgo(0, now), -1))
  const [historySales, historyNet] = await Promise.all([
    dailyByProduct('sales', historyDays[0]!, productId),
    dailyByProduct('net', historyDays[0]!, productId),
  ])
  const sales = historySales.get(productId) ?? new Map<string, number>()
  const endStock = endOfDayStock(
    historyDays,
    inputs.today,
    inputs.stock.get(productId) ?? 0,
    historyNet.get(productId) ?? new Map(),
  )
  const forecast = inputs.forecasts.get(productId)

  return {
    product,
    accuracy: accuracy(forecast),
    history: historyDays.map((date) => ({
      date,
      actual: sales.get(date) ?? 0,
      censored: (endStock.get(date) ?? 0) <= 0,
    })),
    forecast: forecastPoints(forecast, inputs.today),
    recommendation: recommend(inputs, productId, product.supplier.leadTimeDays),
    message: forecast
      ? null
      : 'Not enough history yet: forecasts need at least 28 days of sales data.',
  }
}
