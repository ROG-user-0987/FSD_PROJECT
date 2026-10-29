// Money and cost arithmetic. Prisma's Decimal is decimal.js, so values read from the
// database can be used directly. Never use JS floats for money.
import { Prisma } from '../generated/prisma/client.js'

export type Decimal = Prisma.Decimal
export type DecimalInput = string | number | Prisma.Decimal
export const COST_DECIMALS = 4
export const PRICE_DECIMALS = 2

export const decimal = (value: DecimalInput) => new Prisma.Decimal(value)
export const ZERO = decimal(0)

export const roundCost = (value: Decimal) =>
  value.toDecimalPlaces(COST_DECIMALS, Prisma.Decimal.ROUND_HALF_UP)
export const roundMoney = (value: Decimal) =>
  value.toDecimalPlaces(PRICE_DECIMALS, Prisma.Decimal.ROUND_HALF_UP)

// Correctness rule 4: weighted-average cost after receiving `incomingQty` at `incomingCost`.
//   newAvg = (onHand * currentAvg + incomingQty * incomingCost) / (onHand + incomingQty)
// onHand is the product's total quantity across all warehouses BEFORE the receipt.
export function weightedAverageCost(
  onHand: number,
  currentAvg: Decimal,
  incomingQty: number,
  incomingCost: Decimal,
): Decimal {
  const existing = Math.max(onHand, 0)
  const total = existing + incomingQty
  if (total <= 0) return roundCost(incomingCost)
  return roundCost(currentAvg.mul(existing).add(incomingCost.mul(incomingQty)).div(total))
}

// Sum of quantity x cost over rows, exact (decimal.js).
export function sumValue(rows: { quantity: number; cost: DecimalInput }[]): Decimal {
  return rows.reduce((total, row) => total.add(decimal(row.cost).mul(row.quantity)), ZERO)
}
