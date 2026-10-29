// RBAC matrix: every role against every protected endpoint group.
// "Allowed" means the role passes the permission check: the response is anything
// except 401/403 (a skeleton endpoint answers 501, an empty body answers 400).
import { beforeAll, describe, expect, it } from 'vitest'
import type { Role } from '../src/generated/prisma/client.js'
import { api, loginAs, setupDatabase } from './helpers.js'

const ALL: Role[] = ['ADMIN', 'MANAGER', 'EMPLOYEE', 'VIEWER']
const STAFF: Role[] = ['ADMIN', 'MANAGER', 'EMPLOYEE']
const MANAGERS: Role[] = ['ADMIN', 'MANAGER']
const INSIGHTS: Role[] = ['ADMIN', 'MANAGER', 'VIEWER']
const ADMIN: Role[] = ['ADMIN']

type Method = 'get' | 'post' | 'put' | 'delete'
const MATRIX: [Method, string, Role[]][] = [
  ['get', '/api/users', ADMIN],
  ['post', '/api/users', ADMIN],
  ['put', '/api/users/999999/deactivate', ADMIN],
  ['get', '/api/warehouses', ALL],
  ['post', '/api/warehouses', ADMIN],
  ['put', '/api/warehouses/999999', ADMIN],
  ['get', '/api/categories', ALL],
  ['post', '/api/categories', MANAGERS],
  ['delete', '/api/categories/999999', MANAGERS],
  ['get', '/api/suppliers', ALL],
  ['post', '/api/suppliers', MANAGERS],
  ['get', '/api/products', ALL],
  ['post', '/api/products', MANAGERS],
  ['put', '/api/products/999999', MANAGERS],
  ['get', '/api/inventory', ALL],
  ['post', '/api/inventory/stock-in', STAFF],
  ['post', '/api/inventory/stock-out', STAFF],
  ['post', '/api/inventory/adjust', MANAGERS],
  ['get', '/api/transactions', STAFF],
  ['get', '/api/transfers', STAFF],
  ['post', '/api/transfers', STAFF],
  ['put', '/api/transfers/999999/approve', MANAGERS],
  ['put', '/api/transfers/999999/dispatch', STAFF],
  ['put', '/api/transfers/999999/receive', STAFF],
  ['put', '/api/transfers/999999/cancel', STAFF],
  ['get', '/api/notifications', ALL],
  ['get', '/api/dashboard', INSIGHTS],
  ['get', '/api/analytics/valuation', INSIGHTS],
  ['get', '/api/analytics/dead-stock', INSIGHTS],
  ['get', '/api/forecasts', MANAGERS],
  ['get', '/api/forecasts/999999', MANAGERS],
  ['get', '/api/admin/audit-log', ADMIN],
  ['get', '/api/admin/consistency-check', ADMIN],
]

const tokens = {} as Record<Role, string>

beforeAll(async () => {
  await setupDatabase()
  for (const role of ALL) tokens[role] = (await loginAs(role)).token
})

describe.each(MATRIX)('%s %s', (method, path, allowed) => {
  it('requires authentication', async () => {
    expect((await api()[method](path)).status).toBe(401)
  })

  it.each(ALL)(`%s -> ${allowed.join('/')} allowed`, async (role) => {
    const res = await api()[method](path).set('Authorization', `Bearer ${tokens[role]}`)
    if (allowed.includes(role)) {
      expect([401, 403]).not.toContain(res.status)
    } else {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
  })
})
