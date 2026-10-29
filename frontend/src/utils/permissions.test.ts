import { describe, expect, it } from 'vitest'
import { can, homePathFor, navFor } from './permissions'

describe('can', () => {
  it('follows the permission matrix', () => {
    expect(can('ADMIN', 'users.manage')).toBe(true)
    expect(can('MANAGER', 'users.manage')).toBe(false)
    expect(can('MANAGER', 'stock.adjust')).toBe(true)
    expect(can('EMPLOYEE', 'stock.adjust')).toBe(false)
    expect(can('EMPLOYEE', 'stock.move')).toBe(true)
    expect(can('VIEWER', 'stock.move')).toBe(false)
    expect(can('VIEWER', 'analytics.view')).toBe(true)
    expect(can('VIEWER', 'forecasts.view')).toBe(false)
    expect(can('MANAGER', 'products.reorderLevel')).toBe(false)
  })

  it('denies everything without a role', () => {
    expect(can(undefined, 'products.view')).toBe(false)
  })
})

describe('navigation', () => {
  it('employees see only inventory, products, transfers and transactions', () => {
    expect(navFor('EMPLOYEE').map((item) => item.to)).toEqual([
      '/inventory',
      '/products',
      '/transfers',
      '/transactions',
    ])
  })

  it('viewers see dashboard, inventory, products and analytics', () => {
    expect(navFor('VIEWER').map((item) => item.to)).toEqual([
      '/dashboard',
      '/inventory',
      '/products',
      '/analytics',
    ])
  })

  it('only admins see the administration section', () => {
    expect(navFor('ADMIN').filter((item) => item.group === 'admin')).toHaveLength(2)
    expect(navFor('MANAGER').filter((item) => item.group === 'admin')).toHaveLength(0)
  })

  it('employees land on inventory, everyone else on the dashboard', () => {
    expect(homePathFor('EMPLOYEE')).toBe('/inventory')
    expect(homePathFor('VIEWER')).toBe('/dashboard')
  })
})
