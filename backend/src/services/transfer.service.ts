// Stock transfers between warehouses (correctness rule 5).
//
//   REQUESTED -> APPROVED -> IN_TRANSIT -> RECEIVED
//        \___________\_______> CANCELLED       (only before IN_TRANSIT)
//
// | Step     | Who                                             | Stock effect                      |
// |----------|-------------------------------------------------|-----------------------------------|
// | request  | EMPLOYEE (own warehouse as source), MGR, ADMIN  | none                              |
// | approve  | MANAGER, ADMIN                                  | none (warns if source is short)   |
// | dispatch | source-warehouse EMPLOYEE, MANAGER, ADMIN       | leaves the source (TRANSFER_OUT)  |
// | receive  | destination-warehouse EMPLOYEE, MANAGER, ADMIN  | arrives (TRANSFER_IN)             |
// | cancel   | requester, MANAGER, ADMIN                       | none (only before dispatch)       |
//
// Every status change runs in one transaction that first moves the status with a
// CONDITIONAL update (where: { id, status: <current> }). If someone else changed it a
// moment earlier, count is 0 -> 409. Dispatch decreases every item atomically: if one
// item lacks stock the whole transaction rolls back and nothing moves. The cost of each
// item is frozen at dispatch and reused on receive, so transfers never change avgCost.
// Stock in transit belongs to no warehouse until it is received.
import type { Prisma, StockTransfer, TransferStatus } from '../generated/prisma/client.js'
import { prisma, type Tx } from '../config/prisma.js'
import { emitDashboardStale, emitNotification, emitTransferUpdated } from '../socket/emit.js'
import type { AuthUser } from '../types/express.js'
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js'
import { skipTake } from '../utils/http.js'
import { roundMoney, ZERO } from '../utils/money.js'
import type { PostCommit } from '../utils/postCommit.js'
import type { CreateTransferInput, ListTransfersQuery } from '../validators/stock.validators.js'
import { withIdempotency } from './idempotency.service.js'
import { decreaseStock, increaseStock } from './inventory.service.js'
import { notifyManagers, notifyUser } from './notification.service.js'

export type TransferAction = 'approve' | 'dispatch' | 'receive' | 'cancel'

// The state machine as data: action -> statuses it may start from, and where it leads.
export const TRANSITIONS: Record<TransferAction, { from: TransferStatus[]; to: TransferStatus }> = {
  approve: { from: ['REQUESTED'], to: 'APPROVED' },
  dispatch: { from: ['APPROVED'], to: 'IN_TRANSIT' },
  receive: { from: ['IN_TRANSIT'], to: 'RECEIVED' },
  cancel: { from: ['REQUESTED', 'APPROVED'], to: 'CANCELLED' },
}

// Throws 409 when `action` is not allowed from `current`. Returns the next status.
export function assertTransition(current: TransferStatus, action: TransferAction): TransferStatus {
  const rule = TRANSITIONS[action]
  if (!rule.from.includes(current)) {
    throw conflict('INVALID_TRANSITION', `Cannot ${action} a transfer that is ${current}`, {
      current,
      action,
      allowedFrom: rule.from,
    })
  }
  return rule.to
}

type TransferRef = Pick<
  StockTransfer,
  'status' | 'fromWarehouseId' | 'toWarehouseId' | 'requestedById'
>

const isManager = (actor: AuthUser) => actor.role === 'ADMIN' || actor.role === 'MANAGER'

// May this user take this action on this transfer (ignoring its current status)?
function mayAct(actor: AuthUser, transfer: TransferRef, action: TransferAction): boolean {
  if (isManager(actor)) return true
  if (actor.role !== 'EMPLOYEE') return false
  switch (action) {
    case 'approve':
      return false
    case 'dispatch':
      return actor.warehouseId === transfer.fromWarehouseId
    case 'receive':
      return actor.warehouseId === transfer.toWarehouseId
    case 'cancel':
      return actor.id === transfer.requestedById
  }
}

// Actions this user may take right now (drives the buttons in the detail drawer).
export function availableActions(actor: AuthUser, transfer: TransferRef): TransferAction[] {
  return (Object.keys(TRANSITIONS) as TransferAction[]).filter(
    (action) =>
      TRANSITIONS[action].from.includes(transfer.status) && mayAct(actor, transfer, action),
  )
}

// Employees only see transfers that involve their own warehouse.
function visibleTo(actor: AuthUser): Prisma.StockTransferWhereInput {
  if (actor.role !== 'EMPLOYEE') return {}
  const id = actor.warehouseId ?? -1
  return { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] }
}

const warehouseRef = { select: { id: true, name: true, code: true } } as const
const userRef = { select: { id: true, name: true } } as const

const detailInclude = {
  fromWarehouse: warehouseRef,
  toWarehouse: warehouseRef,
  requestedBy: userRef,
  approvedBy: userRef,
  dispatchedBy: userRef,
  receivedBy: userRef,
  cancelledBy: userRef,
  items: {
    include: { product: { select: { id: true, sku: true, name: true, avgCost: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.StockTransferInclude

type TransferDetail = Prisma.StockTransferGetPayload<{ include: typeof detailInclude }>

function shape(actor: AuthUser, transfer: TransferDetail) {
  const units = transfer.items.reduce((sum, item) => sum + item.quantity, 0)
  const value = transfer.items.reduce(
    (sum, item) => sum.add((item.unitCost ?? item.product.avgCost).mul(item.quantity)),
    ZERO,
  )
  const timeline = [
    { status: 'REQUESTED', at: transfer.createdAt, by: transfer.requestedBy },
    { status: 'APPROVED', at: transfer.approvedAt, by: transfer.approvedBy },
    { status: 'IN_TRANSIT', at: transfer.dispatchedAt, by: transfer.dispatchedBy },
    { status: 'RECEIVED', at: transfer.receivedAt, by: transfer.receivedBy },
    { status: 'CANCELLED', at: transfer.cancelledAt, by: transfer.cancelledBy },
  ].filter((step) => step.at !== null)

  return {
    ...transfer,
    units,
    value: roundMoney(value),
    timeline,
    actions: availableActions(actor, transfer),
  }
}

async function loadTransfer(db: Tx | typeof prisma, actor: AuthUser, id: number) {
  const transfer = await db.stockTransfer.findFirst({
    where: { id, ...visibleTo(actor) },
    include: detailInclude,
  })
  if (!transfer) throw notFound('Transfer')
  return transfer
}

export async function listTransfers(actor: AuthUser, query: ListTransfersQuery) {
  const where: Prisma.StockTransferWhereInput = {
    AND: [
      visibleTo(actor),
      query.status ? { status: query.status } : {},
      query.warehouseId
        ? { OR: [{ fromWarehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }] }
        : {},
    ],
  }
  const [rows, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      where,
      include: detailInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.stockTransfer.count({ where }),
  ])
  return {
    items: rows.map((transfer) => shape(actor, transfer)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

export async function getTransfer(actor: AuthUser, id: number) {
  return shape(actor, await loadTransfer(prisma, actor, id))
}

export function createTransfer(actor: AuthUser, input: CreateTransferInput, key?: string) {
  if (actor.role === 'EMPLOYEE' && actor.warehouseId !== input.fromWarehouseId) {
    throw forbidden('Employees can only request transfers from their own warehouse')
  }
  return withIdempotency(
    { key, userId: actor.id, endpoint: 'POST /transfers', payload: input, statusCode: 201 },
    async (tx, after) => {
      const warehouses = await tx.warehouse.findMany({
        where: { id: { in: [input.fromWarehouseId, input.toWarehouseId] }, isActive: true },
      })
      if (warehouses.length !== 2) throw badRequest('Both warehouses must exist and be active')

      const productIds = input.items.map((item) => item.productId)
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
        select: { id: true },
      })
      if (products.length !== productIds.length) {
        throw badRequest('Every product must exist and be active')
      }

      const created = await tx.stockTransfer.create({
        data: {
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          note: input.note,
          requestedById: actor.id,
          items: { create: input.items },
        },
      })
      const transfer = await loadTransfer(tx, actor, created.id)

      const notifications = isManager(actor)
        ? []
        : await notifyManagers(tx, {
            type: 'TRANSFER',
            title: `Transfer #${transfer.id} needs approval`,
            message: `${actor.name} requested ${input.items.length} item(s) from ${transfer.fromWarehouse.code} to ${transfer.toWarehouse.code}.`,
            data: { transferId: transfer.id },
          })
      queueTransferEvents(after, transfer, notifications)
      return shape(actor, transfer)
    },
  )
}

function queueTransferEvents(
  after: PostCommit,
  transfer: Pick<StockTransfer, 'id' | 'status' | 'fromWarehouseId' | 'toWarehouseId'>,
  notifications: Awaited<ReturnType<typeof notifyUser>>,
) {
  after.add(() => {
    emitTransferUpdated({
      transferId: transfer.id,
      status: transfer.status,
      fromWarehouseId: transfer.fromWarehouseId,
      toWarehouseId: transfer.toWarehouseId,
    })
    for (const notification of notifications) emitNotification(notification)
    emitDashboardStale()
  })
}

export function changeTransferStatus(
  actor: AuthUser,
  id: number,
  action: TransferAction,
  key?: string,
) {
  return withIdempotency(
    { key, userId: actor.id, endpoint: `PUT /transfers/:id/${action}`, payload: { id, action } },
    async (tx, after) => {
      const transfer = await loadTransfer(tx, actor, id)
      if (!mayAct(actor, transfer, action)) {
        throw forbidden(`You cannot ${action} this transfer`)
      }
      const next = assertTransition(transfer.status, action)
      const now = new Date()
      const who = {
        approve: { approvedById: actor.id, approvedAt: now },
        dispatch: { dispatchedById: actor.id, dispatchedAt: now },
        receive: { receivedById: actor.id, receivedAt: now },
        cancel: { cancelledById: actor.id, cancelledAt: now },
      }[action]

      // Conditional status change: only succeeds if nobody moved it in the meantime.
      const moved = await tx.stockTransfer.updateMany({
        where: { id, status: transfer.status },
        data: { status: next, ...who },
      })
      if (moved.count === 0) {
        throw conflict('INVALID_TRANSITION', 'The transfer was changed by someone else; reload it')
      }

      const warnings: string[] = []
      const movement = {
        userId: actor.id,
        userName: actor.name,
        transferId: id,
        reference: `TRF-${id}`,
      }

      if (action === 'approve') {
        // Approval moves no stock, but warn early if the source is short today.
        for (const item of transfer.items) {
          const stock = await tx.inventory.findUnique({
            where: {
              productId_warehouseId: {
                productId: item.productId,
                warehouseId: transfer.fromWarehouseId,
              },
            },
          })
          const available = stock?.quantity ?? 0
          if (available < item.quantity) {
            warnings.push(`${item.product.sku}: ${available} in stock, ${item.quantity} requested`)
          }
        }
      }

      if (action === 'dispatch') {
        for (const item of transfer.items) {
          // Freeze the cost now; it travels with the goods.
          const unitCost = item.product.avgCost
          await decreaseStock(
            tx,
            {
              ...movement,
              productId: item.productId,
              warehouseId: transfer.fromWarehouseId,
              quantity: item.quantity,
              type: 'TRANSFER_OUT',
              unitCost,
            },
            after,
          )
          await tx.stockTransferItem.update({ where: { id: item.id }, data: { unitCost } })
        }
      }

      if (action === 'receive') {
        for (const item of transfer.items) {
          await increaseStock(
            tx,
            {
              ...movement,
              productId: item.productId,
              warehouseId: transfer.toWarehouseId,
              quantity: item.quantity,
              type: 'TRANSFER_IN',
              unitCost: item.unitCost ?? item.product.avgCost,
            },
            after,
          )
        }
      }

      const updated = await loadTransfer(tx, actor, id)
      const notifications =
        transfer.requestedById === actor.id
          ? []
          : await notifyUser(tx, transfer.requestedById, {
              type: 'TRANSFER',
              title: `Transfer #${id} ${next.replace('_', ' ').toLowerCase()}`,
              message: `${actor.name} marked your transfer ${transfer.fromWarehouse.code} → ${transfer.toWarehouse.code} as ${next.replace('_', ' ').toLowerCase()}.`,
              data: { transferId: id },
            })
      queueTransferEvents(after, updated, notifications)
      return { ...shape(actor, updated), warnings }
    },
  )
}
