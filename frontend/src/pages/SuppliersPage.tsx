import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Star, Truck } from 'lucide-react'
import { useState } from 'react'
import { DataTable } from '@/components/DataTable'
import { FilterBar, SearchInput } from '@/components/filters'
import { SupplierDialog } from '@/components/forms/CatalogDialogs'
import { EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { Supplier } from '@/types/api'
import { can } from '@/utils/permissions'

const columns: ColumnDef<Supplier>[] = [
  {
    id: 'name',
    header: 'Supplier',
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        <div className="text-xs text-muted-foreground">{row.original.address}</div>
      </div>
    ),
  },
  {
    id: 'contact',
    header: 'Contact',
    meta: { className: 'hidden md:table-cell' },
    cell: ({ row }) => (
      <div className="text-sm">
        <div>{row.original.email ?? '—'}</div>
        <div className="text-xs text-muted-foreground">{row.original.phone}</div>
      </div>
    ),
  },
  {
    id: 'lead',
    header: 'Lead time',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.leadTimeDays} days</span>,
  },
  {
    id: 'rating',
    header: 'Rating',
    meta: { className: 'text-right' },
    cell: ({ row }) =>
      row.original.rating ? (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Star className="size-3.5 fill-amber-400 text-amber-400" />{' '}
          {Number(row.original.rating).toFixed(1)}
        </span>
      ) : (
        '—'
      ),
  },
  {
    id: 'products',
    header: 'Products',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="tabular-nums">{row.original._count?.products ?? 0}</span>,
  },
]

export function SuppliersPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const debouncedSearch = useDebouncedValue(search)
  const params = { page, pageSize: 20, search: debouncedSearch || undefined }
  const query = useQuery({
    queryKey: [...queryKeys.suppliers, params],
    queryFn: () => api.page<Supplier>('/suppliers', params),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from. Lead times drive the reorder recommendations."
        actions={
          can(user?.role, 'catalog.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New supplier
            </Button>
          )
        }
      />
      <FilterBar>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          placeholder="Search suppliers"
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
          empty={<EmptyState icon={Truck} title="No suppliers found" />}
        />
      )}
      <SupplierDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
