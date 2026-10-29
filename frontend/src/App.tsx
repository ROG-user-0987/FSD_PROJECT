// Routes. Every signed-in page sits inside AppLayout and is guarded by RequireAuth
// with the capability it needs; unauthorized routes redirect to the role's home page.
// Pages are code-split: each one (and heavy libraries such as the charts) loads only
// when it is first opened, which keeps the initial download small.
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { HomeRedirect, RequireAuth } from '@/components/RequireAuth'
import { TableSkeleton } from '@/components/states'
import { AppLayout } from '@/layouts/AppLayout'
import { NotFoundPage, RouteErrorPage } from '@/pages/ErrorPages'
import { LoginPage } from '@/pages/LoginPage'
import type { Capability } from '@/utils/permissions'

// lazy() needs a default export; the pages use named exports.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }))

const DashboardPage = page(() => import('@/pages/DashboardPage'), 'DashboardPage')
const InventoryPage = page(() => import('@/pages/InventoryPage'), 'InventoryPage')
const ProductsPage = page(() => import('@/pages/ProductsPage'), 'ProductsPage')
const ProductDetailPage = page(() => import('@/pages/ProductDetailPage'), 'ProductDetailPage')
const TransfersPage = page(() => import('@/pages/TransfersPage'), 'TransfersPage')
const TransactionsPage = page(() => import('@/pages/TransactionsPage'), 'TransactionsPage')
const WarehousesPage = page(() => import('@/pages/WarehousesPage'), 'WarehousesPage')
const SuppliersPage = page(() => import('@/pages/SuppliersPage'), 'SuppliersPage')
const AnalyticsPage = page(() => import('@/pages/AnalyticsPage'), 'AnalyticsPage')
const ForecastsPage = page(() => import('@/pages/ForecastsPage'), 'ForecastsPage')
const UsersPage = page(() => import('@/pages/UsersPage'), 'UsersPage')
const AuditLogPage = page(() => import('@/pages/AuditLogPage'), 'AuditLogPage')

const guarded = (capability: Capability, element: ReactNode) => (
  <RequireAuth capability={capability}>
    <Suspense fallback={<TableSkeleton />}>{element}</Suspense>
  </RequireAuth>
)

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: guarded('dashboard.view', <DashboardPage />) },
      { path: 'inventory', element: guarded('inventory.view', <InventoryPage />) },
      { path: 'products', element: guarded('products.view', <ProductsPage />) },
      { path: 'products/:id', element: guarded('products.view', <ProductDetailPage />) },
      { path: 'transfers', element: guarded('transfers.view', <TransfersPage />) },
      { path: 'transactions', element: guarded('transactions.view', <TransactionsPage />) },
      { path: 'warehouses', element: guarded('warehouses.view', <WarehousesPage />) },
      { path: 'suppliers', element: guarded('suppliers.view', <SuppliersPage />) },
      { path: 'analytics', element: guarded('analytics.view', <AnalyticsPage />) },
      { path: 'forecasts', element: guarded('forecasts.view', <ForecastsPage />) },
      { path: 'users', element: guarded('users.manage', <UsersPage />) },
      { path: 'audit-log', element: guarded('audit.view', <AuditLogPage />) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
