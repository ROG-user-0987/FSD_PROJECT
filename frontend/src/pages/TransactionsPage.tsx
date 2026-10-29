import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { History } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { QuantityChange, TRANSACTION_LABELS, TransactionTypeBadge } from '@/components/badges'
import { DataTable } from '@/components/DataTable'
import { ALL, FilterBar, FilterSelect, toFilter, toId } from '@/components/filters'
import { EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { useProductOptions, useWarehouses } from '@/hooks/useLookups'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { TransactionRow, TransactionType } from '@/types/api'
import { formatCurrency, formatDateTime, formatNumber } from '@/utils/format'

const TYPES = Object.keys(TRANSACTION_LABELS) as TransactionType[]

const columns: ColumnDef<TransactionRow>[] = [
  {
    id: 'when',
    header: 'When',
    cell: ({ row }) => (
      <div>
        <div className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</div>
        <div className="text-xs text-muted-foreground">by {row.original.user.name}</div>
      </div>
    ),
  },
  {
    id: 'product',
    header: 'Product',
    cell: ({ row }) =>
      row.original.product && (
        <Link to={`/products/${row.original.product.id}`} className="block hover:underline">
          <div className="font-medium">{row.original.product.name}</div>
          <div className="text-xs text-muted-foreground">{row.original.product.sku}</div>
        </Link>
      ),
  },
  {
    id: 'warehouse',
    header: 'Warehouse',
    cell: ({ row }) => (
      <span title={row.original.warehouse.name}>{row.original.warehouse.code}</span>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ row }) => <TransactionTypeBadge type={row.original.type} />,
  },
  {
    id: 'change',
    header: 'Change',
    meta: { className: 'text-right' },
    cell: ({ row }) => <QuantityChange value={row.original.quantityChange} />,
  },
  {
    id: 'after',
    header: 'Balance',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums">{formatNumber(row.original.balanceAfter)}</span>
    ),
  },
  {
    id: 'cost',
    header: 'Unit cost',
    meta: { className: 'text-right hidden lg:table-cell' },
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCurrency(row.original.unitCost)}</span>
    ),
  },
  {
    id: 'note',
    header: 'Reference',
    meta: { className: 'hidden xl:table-cell' },
    cell: ({ row }) => (
      <div className="max-w-48 truncate text-xs text-muted-foreground">
        {[row.original.reference, row.original.reason].filter(Boolean).join(' · ') || '—'}
      </div>
    ),
  },
]

export function TransactionsPage() {
  const { user } = useAuth()
  const warehouses = useWarehouses()
  const products = useProductOptions()
  const [type, setType] = useState(ALL)
  const [warehouseId, setWarehouseId] = useState(ALL)
  const [productId, setProductId] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const params = {
    page,
    pageSize: 25,
    type: toFilter(type),
    warehouseId: toId(warehouseId),
    productId: toId(productId),
    from: from || undefined,
    to: to ? `${to}T23:59:59.999Z` : undefined,
  }
  const query = useQuery({
    queryKey: [...queryKeys.transactions, params],
    queryFn: () => api.page<TransactionRow>('/transactions', params),
    placeholderData: keepPreviousData,
  })
  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value)
      setPage(1)
    }

  return (
    <>
      <PageHeader
        title="Transactions"
        description={
          query.data?.meta
            ? `The append-only stock ledger: ${formatNumber(query.data.meta.total)} movements match.`
            : 'The append-only stock ledger.'
        }
      />
      <FilterBar>
        <FilterSelect
          label="Type"
          value={type}
          onChange={reset(setType)}
          allLabel="All types"
          options={TYPES.map((t) => ({ value: t, label: TRANSACTION_LABELS[t] }))}
        />
        {user?.role !== 'EMPLOYEE' && (
          <FilterSelect
            label="Warehouse"
            value={warehouseId}
            onChange={reset(setWarehouseId)}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
          />
        )}
        <FilterSelect
          label="Product"
          value={productId}
          onChange={reset(setProductId)}
          allLabel="All products"
          className="w-full sm:w-56"
          options={(products.data ?? []).map((p) => ({
            value: String(p.id),
            label: `${p.sku} · ${p.name}`,
          }))}
        />
        <Input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(event) => reset(setFrom)(event.target.value)}
          className="w-full sm:w-40"
        />
        <Input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(event) => reset(setTo)(event.target.value)}
          className="w-full sm:w-40"
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
          empty={<EmptyState icon={History} title="No movements match these filters" />}
        />
      )}
    </>
  )
}
