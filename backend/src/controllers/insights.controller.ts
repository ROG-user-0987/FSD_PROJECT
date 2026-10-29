// Notifications, dashboard, analytics, forecasts and admin tools.
import type { Request, Response } from 'express'
import { currentUser } from '../middleware/authenticate.js'
import { listAuditLog } from '../services/audit.service.js'
import { checkConsistency } from '../services/consistency.service.js'
import * as analytics_ from '../services/analytics.service.js'
import * as forecasts from '../services/forecast.service.js'
import * as notifications from '../services/notification.service.js'
import { sendData, sendPage } from '../utils/http.js'
import type {
  AnalyticsQuery,
  AuditLogQuery,
  ListForecastsQuery,
  ListNotificationsQuery,
} from '../validators/insights.validators.js'
import { idParam, parsedQuery } from './helpers.js'

// ---------------------------------------------------------------- Notifications

export async function listNotifications(req: Request, res: Response) {
  const { unread, ...page } = await notifications.listNotifications(
    currentUser(req).id,
    parsedQuery<ListNotificationsQuery>(req),
  )
  sendData(res, page.items, {
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
    unread,
  })
}
export async function markRead(req: Request, res: Response) {
  sendData(res, await notifications.markRead(currentUser(req).id, idParam(req)))
}
export async function markAllRead(req: Request, res: Response) {
  sendData(res, await notifications.markAllRead(currentUser(req).id))
}

// ---------------------------------------------------------------- Dashboard and analytics

export async function dashboard(_req: Request, res: Response) {
  sendData(res, await analytics_.getDashboard())
}

export function analytics(report: analytics_.AnalyticsReport) {
  return async (req: Request, res: Response) => {
    sendData(res, await analytics_.getAnalytics(report, parsedQuery<AnalyticsQuery>(req)))
  }
}

// ---------------------------------------------------------------- Forecasts

export async function listForecasts(req: Request, res: Response) {
  const { summary, ...page } = await forecasts.listForecasts(parsedQuery<ListForecastsQuery>(req))
  sendData(res, page.items, {
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
    summary,
  })
}
export async function productForecast(req: Request, res: Response) {
  sendData(res, await forecasts.getProductForecast(idParam(req, 'productId')))
}

// ---------------------------------------------------------------- Admin

export async function auditLog(req: Request, res: Response) {
  sendPage(res, await listAuditLog(parsedQuery<AuditLogQuery>(req)))
}
export async function consistencyCheck(_req: Request, res: Response) {
  sendData(res, await checkConsistency())
}
