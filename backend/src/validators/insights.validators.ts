// Notifications, analytics, forecasts and admin queries.
import { z } from 'zod'
import { booleanQuery, optionalId, pagination } from './common.js'

export const listNotificationsQuery = z.object({
  ...pagination,
  unreadOnly: booleanQuery.optional(),
})
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>

export const analyticsQuery = z.object({
  from: z.coerce.date().optional(), // default: 30 days ago
  to: z.coerce.date().optional(), // default: now
  warehouseId: optionalId,
  interval: z.enum(['day', 'week']).default('day'), // stock movement chart
  limit: z.coerce.number().int().min(1).max(100).default(10), // fast/slow lists
  deadDays: z.coerce.number().int().min(1).max(3650).default(90), // dead stock threshold
})
export type AnalyticsQuery = z.infer<typeof analyticsQuery>

export const productIdParam = z.object({ productId: z.coerce.number().int().positive() })

export const listForecastsQuery = z.object({
  ...pagination,
  urgency: z.enum(['ORDER_NOW', 'SOON', 'OK']).optional(),
  categoryId: optionalId,
})
export type ListForecastsQuery = z.infer<typeof listForecastsQuery>

export const auditLogQuery = z.object({
  ...pagination,
  entity: z.string().trim().max(40).optional(),
  userId: optionalId,
})
export type AuditLogQuery = z.infer<typeof auditLogQuery>
