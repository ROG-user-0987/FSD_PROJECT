// Row-level permission checks that the role middleware cannot express.
import type { AuthUser } from '../types/express.js'
import { forbidden } from '../utils/AppError.js'

// EMPLOYEE users may only move stock in their own warehouse.
export function assertWarehouseAccess(actor: AuthUser, warehouseId: number): void {
  if (actor.role === 'EMPLOYEE' && actor.warehouseId !== warehouseId) {
    throw forbidden('Employees can only work with their own warehouse')
  }
}

// Warehouse filter for listings: employees only ever see their own warehouse.
export function scopedWarehouseId(actor: AuthUser, requested?: number): number | undefined {
  return actor.role === 'EMPLOYEE' ? (actor.warehouseId ?? undefined) : requested
}
