// Reorder recommendation: a PURE function (no database), so it is easy to unit-test
// and to explain. forecast.service.ts gathers the inputs and calls it.
//
//   avgDaily       = mean of the forecast's daily demand
//   sigmaDaily     = sample std dev of recent daily demand (last 56 non-censored days)
//   safetyStock    = ceil(1.65 * sigmaDaily * sqrt(leadTime))     -> ~95% service level
//   reorderPoint   = ceil(avgDaily * leadTime + safetyStock)
//   targetCover    = ceil(forecast demand over (leadTime + reviewPeriod) days + safetyStock)
//   onHand         = stock in all warehouses + stock in transit
//   recommendedQty = max(0, targetCover - onHand)
//   urgency        = ORDER_NOW if onHand <= reorderPoint
//                    SOON      if the projected stockout falls within leadTime + reviewPeriod days
//                    OK        otherwise
//
// Edge cases (each one has a test):
// - No forecast yet (fewer than 28 days of history): fall back to the average of the
//   recent demand and say so in the explanation (basis = "history").
// - Zero expected demand: nothing to order, urgency OK. (The plain formula would say
//   ORDER_NOW for 0 stock <= reorder point 0, which would be wrong.)
// - Forecast shorter than the cover window: the missing days use avgDaily.
// - There are no purchase orders in v1, so stock on order is always 0.

export const SERVICE_LEVEL_Z = 1.65 // 95% one-sided normal quantile
export const DEFAULT_REVIEW_PERIOD_DAYS = 7

export type Urgency = 'ORDER_NOW' | 'SOON' | 'OK'

export type ReorderInput = {
  forecastDaily: number[] | null // predicted units per day, starting tomorrow; null = no forecast
  recentDailyDemand: number[] // actual units sold per day (non-censored days only)
  leadTimeDays: number
  onHand: number // across all warehouses
  inTransit: number
  reviewPeriodDays?: number
}

export type ReorderResult = {
  basis: 'forecast' | 'history'
  avgDaily: number
  sigmaDaily: number
  leadTimeDays: number
  reviewPeriodDays: number
  coverDays: number
  demandOverCover: number
  safetyStock: number
  reorderPoint: number
  targetCover: number
  onHand: number
  inTransit: number
  onOrder: 0
  totalAvailable: number
  recommendedQty: number
  stockoutInDays: number | null // first day on which demand exceeds available stock
  urgency: Urgency
  explanation: string
}

const round1 = (value: number) => Math.round(value * 10) / 10

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length
}

// Sample standard deviation (n - 1). Fewer than 2 values -> 0.
export function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

// Daily demand for the next `days` days: the forecast, padded with avgDaily if short.
function demandSeries(forecast: number[] | null, avgDaily: number, days: number): number[] {
  return Array.from({ length: days }, (_, day) => forecast?.[day] ?? avgDaily)
}

export function calculateReorder(input: ReorderInput): ReorderResult {
  const reviewPeriodDays = input.reviewPeriodDays ?? DEFAULT_REVIEW_PERIOD_DAYS
  const leadTimeDays = input.leadTimeDays
  const hasForecast = input.forecastDaily !== null && input.forecastDaily.length > 0
  const basis = hasForecast ? 'forecast' : 'history'

  const avgDaily = hasForecast ? mean(input.forecastDaily ?? []) : mean(input.recentDailyDemand)
  const sigmaDaily = sampleStdDev(input.recentDailyDemand)
  const coverDays = leadTimeDays + reviewPeriodDays
  const forecast = hasForecast ? input.forecastDaily : null

  const demandOverCover = demandSeries(forecast, avgDaily, coverDays).reduce((s, v) => s + v, 0)
  const safetyStock = Math.ceil(SERVICE_LEVEL_Z * sigmaDaily * Math.sqrt(leadTimeDays))
  const reorderPoint = Math.ceil(avgDaily * leadTimeDays + safetyStock)
  const targetCover = Math.ceil(demandOverCover + safetyStock)
  const totalAvailable = input.onHand + input.inTransit
  const recommendedQty = Math.max(0, targetCover - totalAvailable)

  // Walk forward day by day until cumulative demand exceeds what we have.
  let stockoutInDays: number | null = null
  if (avgDaily > 0) {
    const horizon = Math.max(coverDays, forecast?.length ?? 0)
    let cumulative = 0
    for (const [index, demand] of demandSeries(forecast, avgDaily, horizon).entries()) {
      cumulative += demand
      if (cumulative > totalAvailable) {
        stockoutInDays = index + 1
        break
      }
    }
  }

  let urgency: Urgency = 'OK'
  if (avgDaily > 0 && totalAvailable <= reorderPoint) urgency = 'ORDER_NOW'
  else if (stockoutInDays !== null && stockoutInDays <= coverDays) urgency = 'SOON'

  const youHave =
    input.inTransit > 0
      ? `You have ${totalAvailable} (including ${input.inTransit} in transit).`
      : `You have ${totalAvailable}.`
  const explanation =
    avgDaily === 0
      ? `No demand is expected, so there is nothing to order. You have ${totalAvailable}.`
      : [
          basis === 'history'
            ? 'There is no forecast yet, so the recent daily average is used.'
            : null,
          `Expected demand over the next ${coverDays} days is ${Math.round(demandOverCover)} units.`,
          `Supplier lead time is ${leadTimeDays} days.`,
          `With a safety buffer of ${safetyStock} units you need ${targetCover} units of cover.`,
          youHave,
          recommendedQty > 0 ? `Order ${recommendedQty}.` : 'No order is needed.',
        ]
          .filter(Boolean)
          .join(' ')

  return {
    basis,
    avgDaily: round1(avgDaily),
    sigmaDaily: round1(sigmaDaily),
    leadTimeDays,
    reviewPeriodDays,
    coverDays,
    demandOverCover: round1(demandOverCover),
    safetyStock,
    reorderPoint,
    targetCover,
    onHand: input.onHand,
    inTransit: input.inTransit,
    onOrder: 0,
    totalAvailable,
    recommendedQty,
    stockoutInDays,
    urgency,
    explanation,
  }
}
