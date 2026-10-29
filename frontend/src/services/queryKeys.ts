// TanStack Query cache keys, in one place so socket events can invalidate them.
import type { QueryKey } from '@tanstack/react-query'

export const queryKeys = {
  users: ['users'],
  warehouses: ['warehouses'],
  notifications: ['notifications'],
  inventory: ['inventory'],
  products: ['products'],
  transactions: ['transactions'],
  transfers: ['transfers'],
  dashboard: ['dashboard'],
  analytics: ['analytics'],
  auditLog: ['audit-log'],
  consistency: ['consistency-check'],
  forecasts: ['forecasts'],
  suppliers: ['suppliers'],
  categories: ['categories'],
} as const satisfies Record<string, QueryKey>

// Everything a stock movement or transfer can change.
export const stockKeys = [
  queryKeys.inventory,
  queryKeys.products,
  queryKeys.transactions,
  queryKeys.transfers,
  queryKeys.dashboard,
  queryKeys.analytics,
  queryKeys.forecasts,
  queryKeys.warehouses,
  queryKeys.notifications,
]
