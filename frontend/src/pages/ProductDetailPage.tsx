import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { QuantityChange, StockBadge, TransactionTypeBadge } from '@/components/badges'
import { ForecastChart } from '@/components/charts'
import { StockMovementDialog, type MovementMode } from '@/components/forms/StockMovementDialog'
import { KpiCard } from '@/components/KpiCard'
import { AccuracyCard, RecommendationCard } from '@/components/RecommendationCard'
import { ErrorState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { ProductDetail } from '@/types/api'
import { formatCurrency, formatDateTime, formatNumber } from '@/utils/format'
import { can } from '@/utils/permissions'

export function ProductDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const [dialog, setDialog] = useState<{ mode: MovementMode; warehouseId?: number } | null>(null)
  const query = useQuery({
    queryKey: [...queryKeys.products, 'detail', Number(id)],
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
  })
  const product = query.data
  const canMove = can(user?.role, 'stock.move')

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  return (
    <>
      <Link
        to="/products"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Products
      </Link>
      {!product ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <PageHeader
            title={product.name}
            description={`${product.sku} · ${product.category.name}${product.brand ? ` · ${product.brand}` : ''}`}
            actions={
              canMove && (
                <>
                  <Button variant="outline" onClick={() => setDialog({ mode: 'out' })}>
                    <ArrowUpFromLine /> Stock out
                  </Button>
                  <Button onClick={() => setDialog({ mode: 'in' })}>
                    <ArrowDownToLine /> Stock in
                  </Button>
                </>
              )
            }
          />
          {!product.isActive && (
            <Badge variant="destructive" className="mb-4">
              Inactive product
            </Badge>
          )}

          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Total stock"
              value={formatNumber(product.totalQuantity)}
              hint={
                product.inTransit > 0
                  ? `+ ${product.inTransit} in transit`
                  : `reorder level ${product.reorderLevel} per warehouse`
              }
            />
            <KpiCard
              label="Stock value"
              value={formatCurrency(product.stockValue)}
              hint="at weighted-average cost"
            />
            <KpiCard
              label="Average cost"
              value={formatCurrency(product.avgCost)}
              hint={`list cost ${formatCurrency(product.costPrice)}`}
            />
            <KpiCard
              label="Selling price"
              value={formatCurrency(product.sellingPrice)}
              hint={product.margin ? `${product.margin}% margin` : undefined}
            />
          </div>

          {product.forecast && (
            <div className="mb-6 grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Demand: last 90 days and next 30</CardTitle>
                  <CardDescription>
                    Red bars are days the product was out of stock: they are left out of the
                    forecast because real demand was not observed.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ForecastChart
                    history={product.forecast.history}
                    forecast={product.forecast.forecast}
                  />
                </CardContent>
              </Card>
              <AccuracyCard accuracy={product.forecast.accuracy} />
              <div className="lg:col-span-3">
                <RecommendationCard recommendation={product.forecast.recommendation} />
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stock by warehouse</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Warehouse</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="pr-6">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.stock.map((row) => (
                      <TableRow key={row.warehouse.id}>
                        <TableCell className="pl-6">
                          <div className="font-medium">{row.warehouse.code}</div>
                          <div className="text-xs text-muted-foreground">{row.warehouse.name}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(row.quantity)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.value)}
                        </TableCell>
                        <TableCell className="pr-6">
                          <div className="flex items-center gap-1">
                            <StockBadge status={row.stockStatus} />
                            {canMove &&
                              (user?.role !== 'EMPLOYEE' ||
                                user.warehouseId === row.warehouse.id) && (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() =>
                                    setDialog({ mode: 'in', warehouseId: row.warehouse.id })
                                  }
                                >
                                  Stock in
                                </Button>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent movements</CardTitle>
                <CardDescription>
                  Supplier: {product.supplier.name} ({product.supplier.leadTimeDays}-day lead time)
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">When</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="pr-6 text-right">After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.recentTransactions.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="pl-6">
                          <div className="whitespace-nowrap">{formatDateTime(row.createdAt)}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.warehouse.code} · {row.user.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <TransactionTypeBadge type={row.type} />
                        </TableCell>
                        <TableCell className="text-right">
                          <QuantityChange value={row.quantityChange} />
                        </TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">
                          {row.balanceAfter}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {product.description && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Description</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {product.description}
              </CardContent>
            </Card>
          )}

          {dialog && (
            <StockMovementDialog
              mode={dialog.mode}
              defaults={{ productId: product.id, warehouseId: dialog.warehouseId }}
              open
              onOpenChange={(open) => !open && setDialog(null)}
            />
          )}
        </>
      )}
    </>
  )
}
