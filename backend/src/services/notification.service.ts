// In-app notifications (bell dropdown). One row per recipient, so read/unread is per user.
import type { Notification, NotificationType, Prisma } from '../generated/prisma/client.js'
import { prisma, type Tx } from '../config/prisma.js'
import { notFound } from '../utils/AppError.js'
import { skipTake } from '../utils/http.js'
import { toJsonValue } from '../utils/json.js'
import type { ListNotificationsQuery } from '../validators/insights.validators.js'

export async function listNotifications(userId: number, query: ListNotificationsQuery) {
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(query.unreadOnly && { readAt: null }),
  }
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ])
  return { items, total, unread, page: query.page, pageSize: query.pageSize }
}

export async function markRead(userId: number, id: number) {
  return prisma.$transaction(async (tx) => {
    // userId in the filter: nobody can read or mark someone else's notification.
    const notification = await tx.notification.findFirst({ where: { id, userId } })
    if (!notification) throw notFound('Notification')
    if (notification.readAt) return notification
    return tx.notification.update({ where: { id }, data: { readAt: new Date() } })
  })
}

export async function markAllRead(userId: number) {
  const result = await prisma.$transaction((tx) =>
    tx.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }),
  )
  return { updated: result.count }
}

type NewNotification = {
  type: NotificationType
  title: string
  message: string
  data?: Record<string, unknown>
}

// Creates one row per recipient inside the caller's transaction and returns them, so
// the caller can emit `notification:new` AFTER the transaction commits.
async function createFor(tx: Tx, userIds: number[], input: NewNotification) {
  const rows: Notification[] = []
  for (const userId of userIds) {
    rows.push(
      await tx.notification.create({
        data: { ...input, userId, data: input.data ? toJsonValue(input.data) : undefined },
      }),
    )
  }
  return rows
}

// All active ADMIN and MANAGER users (low-stock alerts, new transfer requests).
export async function notifyManagers(tx: Tx, input: NewNotification) {
  const managers = await tx.user.findMany({
    where: { isActive: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  })
  return createFor(
    tx,
    managers.map((user) => user.id),
    input,
  )
}

export function notifyUser(tx: Tx, userId: number, input: NewNotification) {
  return createFor(tx, [userId], input)
}
