// Inventory, transactions and transfers. "Own warehouse only" for employees is
// checked in the services.
import { Router } from 'express'
import * as s from '../controllers/stock.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize, ROLES } from '../middleware/authorize.js'
import { idempotencyKey } from '../middleware/idempotency.js'
import { validate } from '../middleware/validate.js'
import { idParam } from '../validators/common.js'
import {
  adjustBody,
  createTransferBody,
  listInventoryQuery,
  listTransactionsQuery,
  listTransfersQuery,
  stockInBody,
  stockOutBody,
} from '../validators/stock.validators.js'

const staff = authorize(ROLES.STAFF)
const managers = authorize(ROLES.MANAGERS)

export const inventoryRouter = Router()
inventoryRouter.use(authenticate)
inventoryRouter.get(
  '/',
  authorize(ROLES.ALL),
  validate({ query: listInventoryQuery }),
  s.listInventory,
)
inventoryRouter.post('/stock-in', staff, idempotencyKey, validate({ body: stockInBody }), s.stockIn)
inventoryRouter.post(
  '/stock-out',
  staff,
  idempotencyKey,
  validate({ body: stockOutBody }),
  s.stockOut,
)
inventoryRouter.post('/adjust', managers, idempotencyKey, validate({ body: adjustBody }), s.adjust)

export const transactionRouter = Router()
transactionRouter.use(authenticate)
transactionRouter.get('/', staff, validate({ query: listTransactionsQuery }), s.listTransactions)

export const transferRouter = Router()
transferRouter.use(authenticate)
const byId = validate({ params: idParam })
transferRouter.get('/', staff, validate({ query: listTransfersQuery }), s.listTransfers)
transferRouter.post(
  '/',
  staff,
  idempotencyKey,
  validate({ body: createTransferBody }),
  s.createTransfer,
)
transferRouter.get('/:id', staff, byId, s.getTransfer)
transferRouter.put('/:id/approve', managers, idempotencyKey, byId, s.transferAction('approve'))
transferRouter.put('/:id/dispatch', staff, idempotencyKey, byId, s.transferAction('dispatch'))
transferRouter.put('/:id/receive', staff, idempotencyKey, byId, s.transferAction('receive'))
transferRouter.put('/:id/cancel', staff, idempotencyKey, byId, s.transferAction('cancel'))
