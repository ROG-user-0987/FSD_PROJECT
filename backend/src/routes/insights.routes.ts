// Notifications, dashboard, analytics, forecasts and admin tools.
import { Router } from 'express'
import * as i from '../controllers/insights.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize, ROLES } from '../middleware/authorize.js'
import { validate } from '../middleware/validate.js'
import { idParam } from '../validators/common.js'
import {
  analyticsQuery,
  auditLogQuery,
  listForecastsQuery,
  listNotificationsQuery,
  productIdParam,
} from '../validators/insights.validators.js'

export const notificationRouter = Router()
notificationRouter.use(authenticate)
notificationRouter.get('/', validate({ query: listNotificationsQuery }), i.listNotifications)
notificationRouter.put('/read-all', i.markAllRead) // before /:id so "read-all" is not taken as an id
notificationRouter.put('/:id/read', validate({ params: idParam }), i.markRead)

export const dashboardRouter = Router()
dashboardRouter.get('/', authenticate, authorize(ROLES.INSIGHTS), i.dashboard)

export const analyticsRouter = Router()
analyticsRouter.use(authenticate, authorize(ROLES.INSIGHTS), validate({ query: analyticsQuery }))
for (const report of [
  'valuation',
  'turnover',
  'movement',
  'fast-moving',
  'slow-moving',
  'dead-stock',
] as const) {
  analyticsRouter.get(`/${report}`, i.analytics(report))
}

export const forecastRouter = Router()
forecastRouter.use(authenticate, authorize(ROLES.MANAGERS))
forecastRouter.get('/', validate({ query: listForecastsQuery }), i.listForecasts)
forecastRouter.get('/:productId', validate({ params: productIdParam }), i.productForecast)

export const adminRouter = Router()
adminRouter.use(authenticate, authorize(ROLES.ADMIN))
adminRouter.get('/audit-log', validate({ query: auditLogQuery }), i.auditLog)
adminRouter.get('/consistency-check', i.consistencyCheck)
