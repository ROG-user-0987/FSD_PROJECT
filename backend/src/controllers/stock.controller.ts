// Inventory, transactions and transfers.
import type { Request, Response } from 'express'
import { currentUser } from '../middleware/authenticate.js'
import * as inventory from '../services/inventory.service.js'
import { listTransactions as listTransactionHistory } from '../services/transaction.service.js'
import * as transfers from '../services/transfer.service.js'
import { sendCreated, sendData, sendPage } from '../utils/http.js'
import type {
  AdjustInput,
  CreateTransferInput,
  ListInventoryQuery,
  ListTransactionsQuery,
  ListTransfersQuery,
  StockInInput,
  StockOutInput,
} from '../validators/stock.validators.js'
import { idParam, parsedQuery } from './helpers.js'

// ---------------------------------------------------------------- Inventory

export async function listInventory(req: Request, res: Response) {
  sendPage(
    res,
    await inventory.listInventory(currentUser(req), parsedQuery<ListInventoryQuery>(req)),
  )
}
export async function stockIn(req: Request, res: Response) {
  sendCreated(
    res,
    await inventory.stockIn(currentUser(req), req.body as StockInInput, req.idempotencyKey),
  )
}
export async function stockOut(req: Request, res: Response) {
  sendCreated(
    res,
    await inventory.stockOut(currentUser(req), req.body as StockOutInput, req.idempotencyKey),
  )
}
export async function adjust(req: Request, res: Response) {
  sendCreated(
    res,
    await inventory.adjustStock(currentUser(req), req.body as AdjustInput, req.idempotencyKey),
  )
}

// ---------------------------------------------------------------- Transactions

export async function listTransactions(req: Request, res: Response) {
  sendPage(
    res,
    await listTransactionHistory(currentUser(req), parsedQuery<ListTransactionsQuery>(req)),
  )
}

// ---------------------------------------------------------------- Transfers

export async function listTransfers(req: Request, res: Response) {
  sendPage(
    res,
    await transfers.listTransfers(currentUser(req), parsedQuery<ListTransfersQuery>(req)),
  )
}
export async function getTransfer(req: Request, res: Response) {
  sendData(res, await transfers.getTransfer(currentUser(req), idParam(req)))
}
export async function createTransfer(req: Request, res: Response) {
  sendCreated(
    res,
    await transfers.createTransfer(
      currentUser(req),
      req.body as CreateTransferInput,
      req.idempotencyKey,
    ),
  )
}

// One handler per action: approve, dispatch, receive, cancel.
export function transferAction(action: transfers.TransferAction) {
  return async (req: Request, res: Response) => {
    sendData(
      res,
      await transfers.changeTransferStatus(
        currentUser(req),
        idParam(req),
        action,
        req.idempotencyKey,
      ),
    )
  }
}
