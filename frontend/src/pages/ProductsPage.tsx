import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Package, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { StockBadge, STOCK_LABELS } from '@/components/badges'
import { DataTable } from '@/components/DataTable'
import { ALL, FilterBar, FilterSelect, SearchInput, toFilter, toId } from '@/components/filters'
import { ProductDialog } from '@/components/forms/CatalogDialogs'
import { EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useCategories, useSuppliers } from '@/hooks/useLookups'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { ProductListItem } from '@/types/api'
import { formatCurrency, formatNumber } from '@/utils/format'
import { can } from '@/utils/permissions'

const SORTS = [
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sku:asc', label: 'SKU' },
  { value: 'totalQuantity:asc', label: 'Stock: lowest first' },
  { value: 'totalQuantity:desc', label: 'Stock: highest first' },
  { value: 'sellingPrice:desc', label: 'Price: highest first' },
  { value: 'createdAt:desc', label: 'Newest first' },
]

const columns: ColumnDef<ProductListItem>[] = [
  {
    id: 'product',
    header: 'Product',
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.sku}
          {row.original.brand && ` · ${row.original.brand}`}
        </div>
      </div>
    ),
  },
  {
    id: 'category',
    header: 'Category',
    meta: { className: 'hidden md:table-cell' },
    cell: ({ row }) => row.original.category.name,
  },
  {
    id: 'supplier',
    header: 'Supplier',
    meta: { className: 'hidden lg:table-cell' },
    cell: ({ row }) => (
      <div>
        <div>{row.original.supplier.name}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.supplier.leadTimeDays}-day lead time
        </div>
      </div>
    ),
  },
  {
    id: 'price',
    header: 'Price',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <div className="tabular-nums">
        <div>{formatCurrency(row.original.sellingPrice)}</div>
        <div className="text-xs text-muted-foreground">
          avg cost {formatCurrency(row.original.avgCost)}
        </div>
      </div>
    ),
  },
  {
    id: 'stock',
    header: 'Stock',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <div className="tabular-nums">
        <div className="font-medium">{formatNumber(row.original.totalQuantity)}</div>
        <div className="text-xs text-muted-foreground">
          in {row.original.warehouseCount} warehouse{row.original.warehouseCount === 1 ? '' : 's'}
        </div>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <StockBadge status={row.original.stockStatus} />,
  },
]

export function ProductsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  const [supplierId, setSupplierId] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [sort, setSort] = useState('name:asc')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const debouncedSearch = useDebouncedValue(search)
  const categories = useCategories()
  const suppliers = useSuppliers()

  const [sortField, order] = sort.split(':')
  const params = {
    page,
    pageSize: 25,
    search: debouncedSearch || undefined,
    categoryId: toId(categoryId),
    supplierId: toId(supplierId),
    stockStatus: toFilter(status),
    sort: sortField,
    order,
  }
  const query = useQuery({
    queryKey: [...queryKeys.products, params],
    queryFn: () => api.page<ProductListItem>('/products', params),
    placeholderData: keepPreviousData,
  })
  const filter = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setPage(1)
  }

  return (
    <>
      <PageHeader
        title="Products"
        description={
          query.data?.meta
            ? `${formatNumber(query.data.meta.total)} products in the catalogue.`
            : 'Your catalogue.'
        }
        actions={
          can(user?.role, 'catalog.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New product
            </Button>
          )
        }
      />
      <FilterBar>
        <SearchInput
          value={search}
          onChange={filter(setSearch)}
          placeholder="Search name, SKU or brand"
        />
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
          onRowClick={(product) => navigate(`/products/${product.id}`)}
          empty={<EmptyState icon={Package} title="No products match these filters" />}
        />
      )}
      <ProductDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
