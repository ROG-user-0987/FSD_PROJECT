// Typed helpers for server -> client events. Services call these only AFTER their
// database transaction has committed, so clients never see changes that roll back.
// When the socket server is not running (tests, seed script) they do nothing.
import type { Server } from 'socket.io'
import type { Notification, TransactionType, TransferStatus } from '../generated/prisma/client.js'

export type InventoryUpdatedEvent = {
  productId: number
  warehouseId: number
  previousQuantity: number
  newQuantity: number
  type: TransactionType
  userName: string
}

export type ActivityEvent = {
  transactionId: number
  productId: number
  productName: string
  warehouseId: number
  warehouseName: string
  type: TransactionType
  quantityChange: number
  userName: string
  createdAt: string
}

export type TransferUpdatedEvent = {
  transferId: number
  status: TransferStatus
  fromWarehouseId: number
  toWarehouseId: number
}

export type LowStockEvent = {
  productId: number
  warehouseId: number
  quantity: number
  reorderLevel: number
}

let io: Server | null = null

export function setIo(server: Server | null) {
  io = server
}

const warehouseRoom = (id: number) => `warehouse:${id}`
const MANAGER_ROOMS = ['role:ADMIN', 'role:MANAGER']
const DASHBOARD_ROOMS = ['role:ADMIN', 'role:MANAGER', 'role:VIEWER']

export function emitInventoryUpdated(event: InventoryUpdatedEvent) {
  io?.to(warehouseRoom(event.warehouseId)).emit('inventory:updated', event)
}

export function emitActivity(event: ActivityEvent) {
  io?.to(warehouseRoom(event.warehouseId)).emit('activity:new', event)
}

export function emitTransferUpdated(event: TransferUpdatedEvent) {
  io?.to([warehouseRoom(event.fromWarehouseId), warehouseRoom(event.toWarehouseId)]).emit(
    'transfer:updated',
    event,
  )
}

export function emitLowStock(event: LowStockEvent) {
  io?.to(MANAGER_ROOMS).emit('alert:low-stock', event)
}

export function emitNotification(notification: Notification) {
  io?.to(`user:${notification.userId}`).emit('notification:new', notification)
}

// No payload: clients refetch the dashboard query.
export function emitDashboardStale() {
  io?.to(DASHBOARD_ROOMS).emit('dashboard:stale')
}

// Deactivated users lose their live connection immediately.
export function disconnectUser(userId: number) {
  io?.in(`user:${userId}`).disconnectSockets(true)
}
