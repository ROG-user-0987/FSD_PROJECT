// Categories, suppliers, warehouses and products.
// Everyone signed in may read; changes need MANAGER or ADMIN (warehouses: ADMIN).
import { Router } from 'express'
import * as c from '../controllers/catalog.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize, ROLES } from '../middleware/authorize.js'
import { validate } from '../middleware/validate.js'
import {
  categoryBody,
  listProductsQuery,
  listSuppliersQuery,
  listWarehousesQuery,
  productBody,
  productUpdateBody,
  supplierBody,
  supplierUpdateBody,
  warehouseBody,
  warehouseUpdateBody,
} from '../validators/catalog.validators.js'
import { idParam } from '../validators/common.js'

const read = authorize(ROLES.ALL)
const manage = authorize(ROLES.MANAGERS)
const admin = authorize(ROLES.ADMIN)
const byId = validate({ params: idParam })

export const categoryRouter = Router()
categoryRouter.use(authenticate)
categoryRouter.get('/', read, c.listCategories)
categoryRouter.post('/', manage, validate({ body: categoryBody }), c.createCategory)
categoryRouter.put(
  '/:id',
  manage,
  validate({ params: idParam, body: categoryBody }),
  c.updateCategory,
)
categoryRouter.delete('/:id', manage, byId, c.deleteCategory)

export const supplierRouter = Router()
supplierRouter.use(authenticate)
supplierRouter.get('/', read, validate({ query: listSuppliersQuery }), c.listSuppliers)
supplierRouter.get('/:id', read, byId, c.getSupplier)
supplierRouter.post('/', manage, validate({ body: supplierBody }), c.createSupplier)
supplierRouter.put(
  '/:id',
  manage,
  validate({ params: idParam, body: supplierUpdateBody }),
  c.updateSupplier,
)
supplierRouter.delete('/:id', manage, byId, c.deleteSupplier)

export const warehouseRouter = Router()
warehouseRouter.use(authenticate)
warehouseRouter.get('/', read, validate({ query: listWarehousesQuery }), c.listWarehouses)
warehouseRouter.get('/:id', read, byId, c.getWarehouse)
warehouseRouter.post('/', admin, validate({ body: warehouseBody }), c.createWarehouse)
warehouseRouter.put(
  '/:id',
  admin,
  validate({ params: idParam, body: warehouseUpdateBody }),
  c.updateWarehouse,
)

export const productRouter = Router()
productRouter.use(authenticate)
productRouter.get('/', read, validate({ query: listProductsQuery }), c.listProducts)
productRouter.get('/:id', read, byId, c.getProduct)
productRouter.post('/', manage, validate({ body: productBody }), c.createProduct)
// Only ADMIN may change reorderLevel: checked in the service, MANAGER gets 403 for it.
productRouter.put(
  '/:id',
  manage,
  validate({ params: idParam, body: productUpdateBody }),
  c.updateProduct,
)
productRouter.delete('/:id', manage, byId, c.deleteProduct)
