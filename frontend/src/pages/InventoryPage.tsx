import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  MoreHorizontal,
  SlidersHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { StockBadge, STOCK_LABELS } from '@/components/badges'
import { DataTable } from '@/components/DataTable'
import { ALL, FilterBar, FilterSelect, SearchInput, toFilter, toId } from '@/components/filters'
import {
  StockMovementDialog,
  type MovementDefaults,
  type MovementMode,
} from '@/components/forms/StockMovementDialog'
import { EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/hooks/useAuth'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { pairKey, useInventoryFlash } from '@/hooks/useInventoryFlash'
import { useCategories, useSuppliers, useWarehouses } from '@/hooks/useLookups'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { InventoryRow } from '@/types/api'
import { formatCurrency, formatNumber } from '@/utils/format'
import { can } from '@/utils/permissions'

const SORTS = [
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'quantity:asc', label: 'Stock: lowest first' },
  { value: 'quantity:desc', label: 'Stock: highest first' },
  { value: 'value:desc', label: 'Value: highest first' },
]

export function InventoryPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  // The warehouse filter lives in the URL (/inventory?warehouseId=3), so other pages can
  // link straight to one warehouse's stock and the back button keeps the filter.
  const [searchParams, setSearchParams] = useSearchParams()
  const warehouseId = searchParams.get('warehouseId') ?? ALL
  const setWarehouseId = (value: string) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === ALL) next.delete('warehouseId')
        else next.set('warehouseId', value)
        return next
      },
      { replace: true },
    )
  const [supplierId, setSupplierId] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [sort, setSort] = useState('name:asc')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<{ mode: MovementMode; defaults?: MovementDefaults } | null>(
    null,
  )
  const debouncedSearch = useDebouncedValue(search)
  const flashing = useInventoryFlash()

  const categories = useCategories()
  const warehouses = useWarehouses()
  const suppliers = useSuppliers()
  const [sortField, order] = sort.split(':')
  const params = {
    page,
    pageSize: 25,
    search: debouncedSearch || undefined,
    categoryId: toId(categoryId),
    warehouseId: toId(warehouseId),
    supplierId: toId(supplierId),
    stockStatus: toFilter(status),
    sort: sortField,
    order,
  }
  const query = useQuery({
    queryKey: [...queryKeys.inventory, params],
    queryFn: () => api.page<InventoryRow>('/inventory', params),
    placeholderData: keepPreviousData,
  })

  const filter = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setPage(1)
  }
  const canMove = can(user?.role, 'stock.move')
  const canAdjust = can(user?.role, 'stock.adjust')

  const columns: ColumnDef<InventoryRow>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: ({ row }) => (
        <Link to={`/products/${row.original.product.id}`} className="block hover:underline">
          <div className="font-medium">{row.original.product.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.product.sku} · {row.original.product.category.name}
          </div>
        </Link>
      ),
    },
    {
      id: 'warehouse',
      header: 'Warehouse',
      cell: ({ row }) => (
        <span title={row.original.warehouse.name} className="font-medium">
          {row.original.warehouse.code}
        </span>
      ),
    },
    {
      id: 'quantity',
      header: 'On hand',
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <div className="tabular-nums">
          <div className="font-medium">{formatNumber(row.original.quantity)}</div>
          <div className="text-xs text-muted-foreground">
            reorder at {row.original.product.reorderLevel}
          </div>
        </div>
      ),
    },
    {
      id: 'value',
      header: 'Value',
      meta: { className: 'text-right hidden md:table-cell' },
      cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.value)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StockBadge status={row.original.stockStatus} />,
    },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-10 text-right' },
      cell: ({ row }) => {
        if (!canMove) return null
        const defaults = {
          productId: row.original.product.id,
          warehouseId: row.original.warehouse.id,
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${row.original.product.name}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog({ mode: 'in', defaults })}>
                <ArrowDownToLine /> Stock in
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog({ mode: 'out', defaults })}>
                <ArrowUpFromLine /> Stock out
              </DropdownMenuItem>
              {canAdjust && (
                <DropdownMenuItem onSelect={() => setDialog({ mode: 'adjust', defaults })}>
                  <SlidersHorizontal /> Adjust
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Inventory"
        description={
          user?.warehouse
            ? `Stock in ${user.warehouse.name}. Changes appear live.`
            : 'Stock of every product in every warehouse. Changes appear live.'
        }
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
      <FilterBar>
        <SearchInput value={search} onChange={filter(setSearch)} placeholder="Search name or SKU" />
        {user?.role !== 'EMPLOYEE' && (
          <FilterSelect
            label="Warehouse"
            value={warehouseId}
            onChange={filter(setWarehouseId)}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
          />
        )}
        <FilterSelect
          label="Category"
          value={categoryId}
          onChange={filter(setCategoryId)}
          allLabel="All categories"
          options={(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
        />
        <FilterSelect
          label="Supplier"
          value={supplierId}
          onChange={filter(setSupplierId)}
          allLabel="All suppliers"
          options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
        />
        <FilterSelect
          label="Stock status"
          value={status}
          onChange={filter(setStatus)}
          allLabel="Any status"
          className="w-full sm:w-36"
          options={(['in', 'low', 'out'] as const).map((s) => ({
            value: s,
            label: STOCK_LABELS[s],
          }))}
        />
        <FilterSelect label="Sort" value={sort} onChange={filter(setSort)} options={SORTS} />
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
          getRowId={(row) => String(row.id)}
          rowClassName={(row) =>
            flashing.has(pairKey(row.product.id, row.warehouse.id)) ? 'bg-primary/10' : undefined
          }
          empty={
            <EmptyState
              icon={Boxes}
              title="No stock matches these filters"
              description="Try clearing a filter or searching for another product."
            />
          }
        />
      )}
      {dialog && (
        <StockMovementDialog
          mode={dialog.mode}
          defaults={dialog.defaults}
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}
    </>
  )
}
