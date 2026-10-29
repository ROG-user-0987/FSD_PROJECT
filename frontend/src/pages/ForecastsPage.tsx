import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, CheckCircle2, Clock, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { URGENCY_LABELS, UrgencyBadge } from '@/components/badges'
import { DataTable } from '@/components/DataTable'
import { ALL, FilterBar, FilterSelect, toFilter, toId } from '@/components/filters'
import { KpiCard } from '@/components/KpiCard'
import { MODEL_LABELS, percent } from '@/components/RecommendationCard'
import { EmptyState, ErrorState, PageHeader } from '@/components/states'
import { useCategories } from '@/hooks/useLookups'
import { request } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { ForecastRow, ForecastSummary, Urgency } from '@/types/api'
import { cn } from '@/lib/utils'
import { formatDateTime, formatNumber } from '@/utils/format'

const columns: ColumnDef<ForecastRow>[] = [
  {
    id: 'product',
    header: 'Product',
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.product.name}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.product.sku} · {row.original.product.supplier.leadTimeDays}-day lead time
        </div>
      </div>
    ),
  },
  {
    id: 'model',
    header: 'Model',
    meta: { className: 'hidden lg:table-cell' },
    cell: ({ row }) =>
      row.original.accuracy ? (
        <span className="text-sm">
          {MODEL_LABELS[row.original.accuracy.modelName] ?? row.original.accuracy.modelName}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Not enough history</span>
      ),
  },
  {
    id: 'accuracy',
    header: 'WAPE vs baseline',
    meta: { className: 'text-right hidden md:table-cell' },
    cell: ({ row }) => {
      const a = row.original.accuracy
      if (!a || a.wape === null) return <span className="text-muted-foreground">—</span>
      const better = a.baselineWape !== null && a.wape < a.baselineWape
      return (
        <span className="tabular-nums">
          <span className={cn('font-medium', better && 'text-emerald-600 dark:text-emerald-400')}>
            {percent(a.wape)}
          </span>
          <span className="text-muted-foreground"> vs {percent(a.baselineWape)}</span>
        </span>
      )
    },
  },
  {
    id: 'demand',
    header: 'Per day',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.recommendation.avgDaily}</span>,
  },
  {
    id: 'available',
    header: 'Available',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <div className="tabular-nums">
        <div>{formatNumber(row.original.recommendation.totalAvailable)}</div>
        <div className="text-xs text-muted-foreground">
          reorder at {row.original.recommendation.reorderPoint}
        </div>
      </div>
    ),
  },
  {
    id: 'order',
    header: 'Order',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums">
        {formatNumber(row.original.recommendation.recommendedQty)}
      </span>
    ),
  },
  {
    id: 'urgency',
    header: 'Urgency',
    cell: ({ row }) => <UrgencyBadge urgency={row.original.recommendation.urgency} />,
  },
]

export function ForecastsPage() {
  const navigate = useNavigate()
  const categories = useCategories()
  const [urgency, setUrgency] = useState(ALL)
  const [categoryId, setCategoryId] = useState(ALL)
  const [page, setPage] = useState(1)
  const params = { page, pageSize: 25, urgency: toFilter(urgency), categoryId: toId(categoryId) }
  const query = useQuery({
    queryKey: [...queryKeys.forecasts, params],
    queryFn: () => request<ForecastRow[]>('/forecasts', { query: params }),
    placeholderData: keepPreviousData,
  })
  const summary = query.data?.meta?.summary as ForecastSummary | undefined

  return (
    <>
      <PageHeader
        title="Forecasts"
        description="Expected demand for the next 30 days and what to reorder, product by product."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Order now"
          value={summary?.ORDER_NOW ?? '—'}
          icon={AlertTriangle}
          tone="danger"
          loading={!summary}
          hint="at or below the reorder point"
        />
        <KpiCard
          label="Order soon"
          value={summary?.SOON ?? '—'}
          icon={Clock}
          tone="warning"
          loading={!summary}
          hint="stockout expected within lead time + 7 days"
        />
        <KpiCard
          label="OK"
          value={summary?.OK ?? '—'}
          icon={CheckCircle2}
          tone="success"
          loading={!summary}
        />
        <KpiCard
          label="Last forecast run"
          value={summary?.lastRunAt ? formatDateTime(summary.lastRunAt) : 'never'}
          icon={TrendingUp}
          loading={!summary}
          hint={
            summary?.withoutForecast
              ? `${summary.withoutForecast} products without enough history`
              : 'nightly Python job'
          }
        />
      </div>
      <FilterBar>
        <FilterSelect
          label="Urgency"
          value={urgency}
          onChange={(value) => {
            setUrgency(value)
            setPage(1)
          }}
          allLabel="Any urgency"
          options={(['ORDER_NOW', 'SOON', 'OK'] as Urgency[]).map((u) => ({
            value: u,
            label: URGENCY_LABELS[u],
          }))}
        />
        <FilterSelect
          label="Category"
          value={categoryId}
          onChange={(value) => {
            setCategoryId(value)
            setPage(1)
          }}
          allLabel="All categories"
          options={(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
        />
      </FilterBar>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.data}
          meta={query.data?.meta}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          onPageChange={setPage}
          onRowClick={(row) => navigate(`/products/${row.product.id}`)}
          empty={<EmptyState icon={TrendingUp} title="No products match these filters" />}
        />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Stock on order is always 0: InventoryOS v1 has no purchase orders. Open a product to see its
        forecast chart and the full calculation.
      </p>
    </>
  )
}
