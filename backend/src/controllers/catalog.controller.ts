// Categories, suppliers, warehouses and products.
import type { Request, Response } from 'express'
import { currentUser } from '../middleware/authenticate.js'
import * as catalog from '../services/catalog.service.js'
import * as warehouses from '../services/warehouse.service.js'
import { sendCreated, sendData, sendPage } from '../utils/http.js'
import type {
  CategoryInput,
  ListProductsQuery,
  ListSuppliersQuery,
  ListWarehousesQuery,
  ProductInput,
  ProductUpdateInput,
  SupplierInput,
  SupplierUpdateInput,
  WarehouseInput,
  WarehouseUpdateInput,
} from '../validators/catalog.validators.js'
import { idParam, parsedQuery } from './helpers.js'

// ---------------------------------------------------------------- Categories

export async function listCategories(_req: Request, res: Response) {
  sendData(res, await catalog.listCategories())
}
export async function createCategory(req: Request, res: Response) {
  sendCreated(res, await catalog.createCategory(currentUser(req), req.body as CategoryInput))
}
export async function updateCategory(req: Request, res: Response) {
  sendData(
    res,
    await catalog.updateCategory(currentUser(req), idParam(req), req.body as CategoryInput),
  )
}
export async function deleteCategory(req: Request, res: Response) {
  sendData(res, await catalog.deleteCategory(currentUser(req), idParam(req)))
}

// ---------------------------------------------------------------- Suppliers

export async function listSuppliers(req: Request, res: Response) {
  sendPage(res, await catalog.listSuppliers(parsedQuery<ListSuppliersQuery>(req)))
}
export async function getSupplier(req: Request, res: Response) {
  sendData(res, await catalog.getSupplier(idParam(req)))
}
export async function createSupplier(req: Request, res: Response) {
  sendCreated(res, await catalog.createSupplier(currentUser(req), req.body as SupplierInput))
}
export async function updateSupplier(req: Request, res: Response) {
  sendData(
    res,
    await catalog.updateSupplier(currentUser(req), idParam(req), req.body as SupplierUpdateInput),
  )
}
export async function deleteSupplier(req: Request, res: Response) {
  sendData(res, await catalog.deleteSupplier(currentUser(req), idParam(req)))
}

// ---------------------------------------------------------------- Warehouses

export async function listWarehouses(req: Request, res: Response) {
  sendData(res, await warehouses.listWarehouses(parsedQuery<ListWarehousesQuery>(req)))
}
export async function getWarehouse(req: Request, res: Response) {
  sendData(res, await warehouses.getWarehouse(idParam(req)))
}
export async function createWarehouse(req: Request, res: Response) {
  sendCreated(res, await warehouses.createWarehouse(currentUser(req), req.body as WarehouseInput))
}
export async function updateWarehouse(req: Request, res: Response) {
  sendData(
    res,
    await warehouses.updateWarehouse(
      currentUser(req),
      idParam(req),
      req.body as WarehouseUpdateInput,
    ),
  )
}

// ---------------------------------------------------------------- Products

export async function listProducts(req: Request, res: Response) {
  sendPage(res, await catalog.listProducts(parsedQuery<ListProductsQuery>(req)))
}
export async function getProduct(req: Request, res: Response) {
  sendData(res, await catalog.getProduct(currentUser(req), idParam(req)))
}
export async function createProduct(req: Request, res: Response) {
  sendCreated(res, await catalog.createProduct(currentUser(req), req.body as ProductInput))
}
export async function updateProduct(req: Request, res: Response) {
  sendData(
    res,
    await catalog.updateProduct(currentUser(req), idParam(req), req.body as ProductUpdateInput),
  )
}
export async function deleteProduct(req: Request, res: Response) {
  sendData(res, await catalog.deleteProduct(currentUser(req), idParam(req)))
}
