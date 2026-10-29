// What each role may see and do in the UI. This only hides things for convenience:
// the backend enforces every rule again (see backend/docs/API.md).
import type { Role } from '@/types/api'

export type Capability =
  | 'dashboard.view'
  | 'products.view'
  | 'inventory.view'
  | 'warehouses.view'
  | 'transfers.view'
  | 'suppliers.view'
  | 'transactions.view'
  | 'analytics.view'
  | 'forecasts.view'
  | 'users.manage'
  | 'audit.view'
  | 'warehouses.manage'
  | 'catalog.manage'
  | 'products.reorderLevel'
  | 'stock.move'
  | 'stock.adjust'
  | 'transfers.request'
  | 'transfers.approve'
  | 'transfers.move'

const A: Role = 'ADMIN'
const M: Role = 'MANAGER'
const E: Role = 'EMPLOYEE'
const V: Role = 'VIEWER'

const MATRIX: Record<Capability, readonly Role[]> = {
  'dashboard.view': [A, M, V],
  'products.view': [A, M, E, V],
  'inventory.view': [A, M, E, V],
  'warehouses.view': [A, M],
  'transfers.view': [A, M, E],
  'suppliers.view': [A, M],
  'transactions.view': [A, M, E],
  'analytics.view': [A, M, V],
  'forecasts.view': [A, M],
  'users.manage': [A],
  'audit.view': [A],
  'warehouses.manage': [A],
  'catalog.manage': [A, M],
  'products.reorderLevel': [A],
  'stock.move': [A, M, E],
  'stock.adjust': [A, M],
  'transfers.request': [A, M, E],
  'transfers.approve': [A, M],
  'transfers.move': [A, M, E],
}

export function can(role: Role | undefined, capability: Capability): boolean {
  return role !== undefined && MATRIX[capability].includes(role)
}

export type NavItem = { label: string; to: string; capability: Capability; group: 'main' | 'admin' }

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', capability: 'dashboard.view', group: 'main' },
  { label: 'Inventory', to: '/inventory', capability: 'inventory.view', group: 'main' },
  { label: 'Products', to: '/products', capability: 'products.view', group: 'main' },
  { label: 'Transfers', to: '/transfers', capability: 'transfers.view', group: 'main' },
  { label: 'Transactions', to: '/transactions', capability: 'transactions.view', group: 'main' },
  { label: 'Warehouses', to: '/warehouses', capability: 'warehouses.view', group: 'main' },
  { label: 'Suppliers', to: '/suppliers', capability: 'suppliers.view', group: 'main' },
  { label: 'Analytics', to: '/analytics', capability: 'analytics.view', group: 'main' },
  { label: 'Forecasts', to: '/forecasts', capability: 'forecasts.view', group: 'main' },
  { label: 'Users', to: '/users', capability: 'users.manage', group: 'admin' },
  { label: 'Audit log', to: '/audit-log', capability: 'audit.view', group: 'admin' },
]

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => can(role, item.capability))
}

// Where to land after login, and where unauthorized routes redirect to.
export function homePathFor(role: Role): string {
  return can(role, 'dashboard.view') ? '/dashboard' : '/inventory'
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  VIEWER: 'Viewer',
}
