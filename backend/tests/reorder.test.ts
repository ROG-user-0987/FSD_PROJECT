// Hand-computed cases for the reorder recommendation (pure function, no database).
import { describe, expect, it } from 'vitest'
import { calculateReorder, sampleStdDev } from '../src/services/reorder.service.js'

// Recent demand with mean 4 and sample std dev sqrt(16/7) = 1.5119.
const RECENT = [2, 4, 6, 4, 2, 6, 4, 4]
const FLAT_FORECAST = Array.from({ length: 30 }, () => 4)

describe('calculateReorder', () => {
  it('computes the standard sample std dev', () => {
    expect(sampleStdDev(RECENT)).toBeCloseTo(Math.sqrt(16 / 7), 10)
    expect(sampleStdDev([5])).toBe(0)
  })

  // leadTime 4, review 7 -> cover 11 days.
  // safety = ceil(1.65 * 1.5119 * sqrt(4)) = ceil(4.989) = 5
  // reorderPoint = ceil(4 * 4 + 5) = 21; target = ceil(44 + 5) = 49
  it('SOON: above the reorder point, but stockout inside the cover window', () => {
    const r = calculateReorder({
      forecastDaily: FLAT_FORECAST,
      recentDailyDemand: RECENT,
      leadTimeDays: 4,
      onHand: 30,
      inTransit: 0,
    })
    expect(r).toMatchObject({
      basis: 'forecast',
      safetyStock: 5,
      reorderPoint: 21,
      targetCover: 49,
      recommendedQty: 19,
      stockoutInDays: 8, // 4 * 8 = 32 > 30
      urgency: 'SOON',
      onOrder: 0,
    })
    expect(r.explanation).toBe(
      'Expected demand over the next 11 days is 44 units. Supplier lead time is 4 days. ' +
        'With a safety buffer of 5 units you need 49 units of cover. You have 30. Order 19.',
    )
  })

  it('ORDER_NOW: at or below the reorder point', () => {
    const r = calculateReorder({
      forecastDaily: FLAT_FORECAST,
      recentDailyDemand: RECENT,
      leadTimeDays: 4,
      onHand: 21,
      inTransit: 0,
    })
    expect(r.urgency).toBe('ORDER_NOW')
    expect(r.recommendedQty).toBe(28)
  })

  it('counts stock in transit as available', () => {
    const r = calculateReorder({
      forecastDaily: FLAT_FORECAST,
      recentDailyDemand: RECENT,
      leadTimeDays: 4,
      onHand: 15,
      inTransit: 10,
    })
    expect(r.totalAvailable).toBe(25)
    expect(r.recommendedQty).toBe(24)
    expect(r.stockoutInDays).toBe(7) // 4 * 7 = 28 > 25
    expect(r.urgency).toBe('SOON')
    expect(r.explanation).toContain('You have 25 (including 10 in transit).')
  })

  it('OK: plenty of stock', () => {
    const r = calculateReorder({
      forecastDaily: FLAT_FORECAST,
      recentDailyDemand: RECENT,
      leadTimeDays: 4,
      onHand: 200,
      inTransit: 0,
    })
    expect(r.urgency).toBe('OK')
    expect(r.recommendedQty).toBe(0)
    expect(r.explanation).toContain('No order is needed.')
  })

  it('zero demand: nothing to order, even with zero stock', () => {
    const r = calculateReorder({
      forecastDaily: Array.from({ length: 30 }, () => 0),
      recentDailyDemand: [0, 0, 0, 0],
      leadTimeDays: 5,
      onHand: 0,
      inTransit: 0,
    })
    expect(r).toMatchObject({ recommendedQty: 0, urgency: 'OK', stockoutInDays: null })
  })

  // No forecast: avg 3 from history, sigma 0 -> safety 0; leadTime 2 -> cover 9 days.
  // reorderPoint = 6, target = 27, have 10 -> order 17; 3 * 4 = 12 > 10 -> day 4.
  it('missing forecast: falls back to the recent average and says so', () => {
    const r = calculateReorder({
      forecastDaily: null,
      recentDailyDemand: [3, 3, 3, 3],
      leadTimeDays: 2,
      onHand: 10,
      inTransit: 0,
    })
    expect(r).toMatchObject({
      basis: 'history',
      safetyStock: 0,
      reorderPoint: 6,
      targetCover: 27,
      recommendedQty: 17,
      stockoutInDays: 4,
      urgency: 'SOON',
    })
    expect(r.explanation).toMatch(/^There is no forecast yet/)
  })

  it('pads a short forecast with its average', () => {
    const r = calculateReorder({
      forecastDaily: [2, 2, 2],
      recentDailyDemand: [2, 2],
      leadTimeDays: 3,
      onHand: 100,
      inTransit: 0,
    })
    expect(r.demandOverCover).toBe(20) // 10 days * 2
  })
})
