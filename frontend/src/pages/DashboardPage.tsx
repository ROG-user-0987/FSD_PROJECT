import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpFromLine,
  Boxes,
  IndianRupee,
  Package,
  PackageX,
  Truck,
  Warehouse,
} from 'lucide-react'
import { Link } from 'react-router'
import { QuantityChange, StockBadge, TRANSACTION_LABELS } from '@/components/badges'
import { MovementChart, ValueBarChart } from '@/components/charts'
import { KpiCard } from '@/components/KpiCard'
import { ErrorState, PageHeader } from '@/components/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { Dashboard } from '@/types/api'
import { formatCurrencyCompact, formatNumber, formatRelative } from '@/utils/format'

export function DashboardPage() {
  const { user } = useAuth()
  // Kept fresh by socket events (`dashboard:stale` invalidates this query).
  const query = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get<Dashboard>('/dashboard'),
  })
  const d = query.data

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.name.split(' ')[0] ?? ''}`}
        description="Live overview of stock across all warehouses."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Inventory value"
          icon={IndianRupee}
          loading={!d}
          value={d && formatCurrencyCompact(d.kpis.inventoryValue)}
          hint="at weighted-average cost"
        />
        <KpiCard
          label="Units in stock"
          icon={Boxes}
          loading={!d}
          value={d && formatNumber(d.kpis.totalUnits)}
          hint={d && `${d.kpis.totalProducts} active products`}
        />
        <KpiCard
          label="Low stock"
          icon={AlertTriangle}
          tone="warning"
          loading={!d}
          value={d && d.kpis.lowStockCount}
          hint="product × warehouse at or below reorder level"
        />
        <KpiCard
          label="Out of stock"
          icon={PackageX}
          tone="danger"
          loading={!d}
          value={d && d.kpis.outOfStockCount}
          hint="product × warehouse with nothing left"
        />
        <KpiCard
          label="Outgoing (30 days)"
          icon={ArrowUpFromLine}
          loading={!d}
          value={d && formatNumber(d.kpis.outgoingUnits30d)}
          hint="units sold or issued"
        />
        <KpiCard
          label="In transit"
          icon={Truck}
          loading={!d}
          value={d && `${formatNumber(d.kpis.inTransit.units)} units`}
          hint={
            d &&
            `${d.kpis.inTransit.transfers} transfers · ${formatCurrencyCompact(d.kpis.inTransit.value)}`
          }
        />
        <KpiCard label="Products" icon={Package} loading={!d} value={d && d.kpis.totalProducts} />
        <KpiCard label="Warehouses" icon={Warehouse} loading={!d} value={d && d.kpis.warehouses} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Inventory movement</CardTitle>
            <CardDescription>Units in vs out per day, last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {d ? <MovementChart data={d.charts.movement} /> : <Skeleton className="h-64 w-full" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>Updates live as stock moves.</CardDescription>
          </CardHeader>
          <CardContent>
            {!d ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ul className="space-y-3">
                {d.recentActivity.slice(0, 8).map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <Link
                        to={`/products/${row.product?.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {row.product?.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {TRANSACTION_LABELS[row.type]} · {row.warehouse.code} · {row.user.name} ·{' '}
                        {formatRelative(row.createdAt)}
                      </div>
                    </div>
                    <QuantityChange value={row.quantityChange} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inventory value by warehouse</CardTitle>
          </CardHeader>
          <CardContent>
            {d ? (
              <ValueBarChart
                height={220}
                data={d.charts.valueByWarehouse.map((row) => ({
                  label: row.warehouse.name,
                  value: Number(row.value),
                }))}
              />
            ) : (
              <Skeleton className="h-56 w-full" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock by category</CardTitle>
          </CardHeader>
          <CardContent>
            {d ? (
              <ValueBarChart
                height={220}
                data={d.charts.stockByCategory.map((row) => ({
                  label: row.category,
                  value: Number(row.value),
                }))}
              />
            ) : (
              <Skeleton className="h-56 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top fast-moving products</CardTitle>
            <CardDescription>Units sold per day, last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {!d ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ul className="space-y-3">
                {d.charts.fastMoving.map((row, index) => (
                  <li key={row.product.id} className="flex items-center gap-3 text-sm">
                    <span className="w-5 text-muted-foreground tabular-nums">{index + 1}</span>
                    <Link
                      to={`/products/${row.product.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {row.product.name}
                    </Link>
                    <span className="tabular-nums">{row.perDay}/day</span>
                    <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">
                      {formatNumber(row.stock)} left
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">Needs attention</CardTitle>
              <CardDescription>Lowest stock relative to the reorder level.</CardDescription>
            </div>
            <Link to="/inventory" className="text-sm text-primary hover:underline">
              View inventory
            </Link>
          </CardHeader>
          <CardContent>
            {!d ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ul className="space-y-3">
                {d.charts.lowStock.map((row) => (
                  <li
                    key={`${row.product.id}-${row.warehouse.id}`}
                    className="flex items-center gap-3 text-sm"
                  >
                    <Link
                      to={`/products/${row.product.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {row.product.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{row.warehouse.code}</span>
                    <span className="w-14 text-right tabular-nums">
                      {row.quantity}/{row.reorderLevel}
                    </span>
                    <StockBadge status={row.stockStatus} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
