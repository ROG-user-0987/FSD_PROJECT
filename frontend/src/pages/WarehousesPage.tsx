import { MapPin, Users, Warehouse as WarehouseIcon } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useWarehouses } from '@/hooks/useLookups'
import { formatCurrency, formatNumber } from '@/utils/format'

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-medium tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  )
}

export function WarehousesPage() {
  const query = useWarehouses()

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Where your stock is kept, and what it is worth."
      />
      {query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState icon={WarehouseIcon} title="No warehouses yet" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.map((warehouse) => (
            <Card key={warehouse.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">{warehouse.name}</CardTitle>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="size-3.5" /> {warehouse.city}
                  </div>
                </div>
                <Badge variant="outline">{warehouse.code}</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Stock value" value={formatCurrency(warehouse.stock?.value)} />
                  <Stat label="Units" value={formatNumber(warehouse.stock?.units ?? 0)} />
                  <Stat
                    label="Low stock"
                    value={warehouse.stock?.lowStock ?? 0}
                    tone="text-amber-600 dark:text-amber-400"
                  />
                  <Stat
                    label="Out of stock"
                    value={warehouse.stock?.outOfStock ?? 0}
                    tone="text-red-600 dark:text-red-400"
                  />
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5" /> {warehouse._count?.users ?? 0} staff ·{' '}
                    {warehouse.stock?.products ?? 0} products
                  </span>
                  <Link
                    to={`/inventory?warehouseId=${warehouse.id}`}
                    className="text-primary hover:underline"
                  >
                    View inventory
                  </Link>
                </div>
                {warehouse.address && (
                  <p className="text-xs text-muted-foreground">{warehouse.address}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
