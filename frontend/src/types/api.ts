// Mirrors the backend contract (backend/docs/API.md) by hand.
// Money is always a string (e.g. "1249.50"); dates are ISO 8601 strings.

export type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'VIEWER'

export type Money = string

export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number }

export type ApiEnvelope<T> = { data: T; meta?: PageMeta & Record<string, unknown> }

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown }
}

export type Ref = { id: number; name: string }
export type WarehouseRef = { id: number; name: string; code: string }
export type ProductRef = { id: number; sku: string; name: string }

export type StockStatus = 'in' | 'low' | 'out'

// ---------------------------------------------------------------- Users

export type User = {
  id: number
  email: string
  name: string
  role: Role
  warehouseId: number | null
  warehouse: WarehouseRef | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type Session = { accessToken: string; expiresIn: number; user: User }

// ---------------------------------------------------------------- Catalogue

export type Warehouse = WarehouseRef & {
  city: string
  address: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  _count?: { users: number; inventory: number }
  stock?: { units: number; value: Money; products: number; lowStock: number; outOfStock: number }
}

export type Category = Ref & { _count?: { products: number } }

export type Supplier = {
  id: number
  name: string
  email: string | null
  phone: string | null
  address: string | null
  leadTimeDays: number
  rating: string | null
  _count?: { products: number }
}

export type ProductListItem = ProductRef & {
  brand: string | null
  imageUrl: string | null
  costPrice: Money
  avgCost: Money
  sellingPrice: Money
  reorderLevel: number
  isActive: boolean
  createdAt: string
  category: Ref
  supplier: Ref & { leadTimeDays: number }
  totalQuantity: number
  warehouseCount: number
  stockValue: Money
  stockStatus: StockStatus
}

export type ProductDetail = Omit<ProductListItem, 'warehouseCount' | 'stockStatus' | 'supplier'> & {
  description: string | null
  supplier: Ref & { leadTimeDays: number; email: string | null; phone: string | null }
  inTransit: number
  margin: Money | null
  stock: { warehouse: WarehouseRef; quantity: number; value: Money; stockStatus: StockStatus }[]
  recentTransactions: TransactionRow[]
  forecast: ProductForecast | null
}

// ---------------------------------------------------------------- Stock

export type TransactionType =
  | 'STOCK_IN'
  | 'PURCHASE'
  | 'STOCK_OUT'
  | 'SALE'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'

export type InventoryRow = {
  id: number
  product: ProductRef & {
    reorderLevel: number
    avgCost: Money
    category: Ref
    supplier: Ref
  }
  warehouse: WarehouseRef
  quantity: number
  value: Money
  stockStatus: StockStatus
  updatedAt: string
}

export type InventoryTransaction = {
  id: number
  productId: number
  warehouseId: number
  type: TransactionType
  quantityChange: number
  unitCost: Money
  balanceAfter: number
  reason: string | null
  reference: string | null
  transferId: number | null
  userId: number
  createdAt: string
}

export type TransactionRow = InventoryTransaction & {
  product?: ProductRef
  warehouse: WarehouseRef
  user: Ref
}

export type MovementResponse = {
  transaction: InventoryTransaction
  previousQuantity: number
  newQuantity: number
  alert: 'LOW_STOCK' | 'OUT_OF_STOCK' | null
}

export type TransferStatus = 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'
export type TransferAction = 'approve' | 'dispatch' | 'receive' | 'cancel'

export type Transfer = {
  id: number
  status: TransferStatus
  note: string | null
  fromWarehouse: WarehouseRef
  toWarehouse: WarehouseRef
  fromWarehouseId: number
  toWarehouseId: number
  requestedBy: Ref
  approvedBy: Ref | null
  dispatchedBy: Ref | null
  receivedBy: Ref | null
  cancelledBy: Ref | null
  createdAt: string
  items: {
    id: number
    productId: number
    quantity: number
    unitCost: Money | null
    product: ProductRef & { avgCost: Money }
  }[]
  units: number
  value: Money
  timeline: { status: TransferStatus; at: string; by: Ref | null }[]
  actions: TransferAction[]
  warnings?: string[]
}

// ---------------------------------------------------------------- Notifications and admin

export type NotificationType = 'LOW_STOCK' | 'OUT_OF_STOCK' | 'TRANSFER'

export type AppNotification = {
  id: number
  userId: number
  type: NotificationType
  title: string
  message: string
  data: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

export type ConsistencyReport = {
  ok: boolean
  checkedPairs: number
  mismatches: { productId: number; warehouseId: number; quantity: number; ledgerSum: number }[]
  checkedAt: string
}

export type AuditEntry = {
  id: number
  userId: number
  action: string
  entity: string
  entityId: string
  before: unknown
  after: unknown
  createdAt: string
  user: { id: number; name: string; email: string }
}

// ---------------------------------------------------------------- Dashboard and analytics

export type Dashboard = {
  kpis: {
    totalProducts: number
    totalUnits: number
    inventoryValue: Money
    lowStockCount: number
    outOfStockCount: number
    inTransit: { transfers: number; units: number; value: Money }
    outgoingUnits30d: number
    warehouses: number
  }
  charts: {
    movement: MovementPoint[]
    stockByCategory: { category: string; units: number; value: Money }[]
    valueByWarehouse: { warehouse: WarehouseRef; units: number; value: Money }[]
    fastMoving: { product: ProductRef; unitsSold: number; perDay: number; stock: number }[]
    lowStock: {
      product: ProductRef
      warehouse: WarehouseRef
      quantity: number
      reorderLevel: number
      stockStatus: StockStatus
    }[]
  }
  recentActivity: TransactionRow[]
}

export type MovementPoint = { date: string; incoming: number; outgoing: number }

export type Valuation = {
  total: Money
  units: number
  inTransit: { transfers: number; units: number; value: Money }
  byWarehouse: { warehouse: WarehouseRef; units: number; value: Money; share: number }[]
  byCategory: { category: string; units: number; value: Money; share: number }[]
  topProducts: { product: ProductRef; units: number; value: Money }[]
}

export type Turnover = {
  from: string
  to: string
  days: number
  cogs: Money
  openingValue: Money
  closingValue: Money
  averageValue: Money
  turnover: number | null
  annualisedTurnover: number | null
  daysOfInventory: number | null
  cogsByCategory: { category: string; cogs: Money }[]
}

export type Velocity = {
  from: string
  to: string
  days: number
  thresholdPerDay?: number
  items: {
    product: ProductRef & { category: Ref }
    unitsSold: number
    perDay: number
    stock: number
    daysOfCover: number | null
  }[]
}

export type DeadStock = {
  deadDays: number
  totalValue: Money
  count: number
  items: {
    product: ProductRef & { category: Ref }
    units: number
    value: Money
    lastOutgoingAt: string | null
    daysSinceOutgoing: number | null
  }[]
}

// ---------------------------------------------------------------- Forecasts

export type Urgency = 'ORDER_NOW' | 'SOON' | 'OK'

export type Recommendation = {
  basis: 'forecast' | 'history'
  avgDaily: number
  sigmaDaily: number
  leadTimeDays: number
  reviewPeriodDays: number
  coverDays: number
  demandOverCover: number
  safetyStock: number
  reorderPoint: number
  targetCover: number
  onHand: number
  inTransit: number
  onOrder: 0
  totalAvailable: number
  recommendedQty: number
  stockoutInDays: number | null
  urgency: Urgency
  explanation: string
}

export type ForecastAccuracy = {
  modelName: string
  wape: number | null
  baselineWape: number | null
  improvement: number | null
  trainingDays: number
  horizonDays: number
  predictedTotal: number
  generatedAt: string
}

export type ForecastRow = {
  product: ProductRef & {
    reorderLevel: number
    category: Ref
    supplier: Ref & { leadTimeDays: number }
  }
  accuracy: ForecastAccuracy | null
  recommendation: Recommendation
}

export type ForecastSummary = {
  ORDER_NOW: number
  SOON: number
  OK: number
  withoutForecast: number
  lastRunAt: string | null
}

export type ProductForecast = {
  product: ProductRef & { supplier: Ref & { leadTimeDays: number } }
  accuracy: ForecastAccuracy | null
  history: { date: string; actual: number; censored: boolean }[]
  forecast: { date: string; qty: number }[]
  recommendation: Recommendation
  message: string | null
}
