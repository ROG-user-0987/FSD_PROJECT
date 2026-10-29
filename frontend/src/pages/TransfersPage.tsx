import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowLeftRight, ArrowRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { TRANSFER_LABELS, TransferStatusBadge } from '@/components/badges'
import { DataTable } from '@/components/DataTable'
import { ALL, FilterBar, FilterSelect, toFilter, toId } from '@/components/filters'
import { CreateTransferDialog, TransferSheet } from '@/components/forms/TransferDialogs'
import { EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useWarehouses } from '@/hooks/useLookups'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { Transfer, TransferStatus } from '@/types/api'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { can } from '@/utils/permissions'

const columns: ColumnDef<Transfer>[] = [
  {
    id: 'id',
    header: '#',
    cell: ({ row }) => <span className="font-medium tabular-nums">#{row.original.id}</span>,
  },
  {
    id: 'route',
    header: 'Route',
    cell: ({ row }) => (
      <div>
        <div className="inline-flex items-center gap-1.5 font-medium">
          {row.original.fromWarehouse.code}{' '}
          <ArrowRight className="size-3.5 text-muted-foreground" /> {row.original.toWarehouse.code}
        </div>
        {row.original.note && (
          <div className="max-w-56 truncate text-xs text-muted-foreground">{row.original.note}</div>
        )}
      </div>
    ),
  },
  {
    id: 'items',
    header: 'Items',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <div className="tabular-nums">
        <div>{row.original.units} units</div>
        <div className="text-xs text-muted-foreground">
          {row.original.items.length} product{row.original.items.length === 1 ? '' : 's'} ·{' '}
          {formatCurrency(row.original.value)}
        </div>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <TransferStatusBadge status={row.original.status} />,
  },
  {
    id: 'requested',
    header: 'Requested',
    meta: { className: 'hidden md:table-cell' },
    cell: ({ row }) => (
      <div>
        <div className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</div>
        <div className="text-xs text-muted-foreground">{row.original.requestedBy.name}</div>
      </div>
    ),
  },
]

const STATUSES: TransferStatus[] = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']

export function TransfersPage() {
  const { user } = useAuth()
  const warehouses = useWarehouses()
  const [status, setStatus] = useState(ALL)
  const [warehouseId, setWarehouseId] = useState(ALL)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const params = { page, pageSize: 20, status: toFilter(status), warehouseId: toId(warehouseId) }
  const query = useQuery({
    queryKey: [...queryKeys.transfers, params],
    queryFn: () => api.page<Transfer>('/transfers', params),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Move stock between warehouses: requested → approved → in transit → received."
        actions={
          can(user?.role, 'transfers.request') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New transfer
            </Button>
          )
        }
      />
      <FilterBar>
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
          allLabel="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: TRANSFER_LABELS[s] }))}
        />
        {user?.role !== 'EMPLOYEE' && (
          <FilterSelect
            label="Warehouse"
            value={warehouseId}
            onChange={(value) => {
              setWarehouseId(value)
              setPage(1)
            }}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
          />
        )}
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
          onRowClick={(transfer) => setOpenId(transfer.id)}
          empty={<EmptyState icon={ArrowLeftRight} title="No transfers match these filters" />}
        />
      )}
      <TransferSheet id={openId} onClose={() => setOpenId(null)} />
      <CreateTransferDialog open={creating} onOpenChange={setCreating} onCreated={setOpenId} />
    </>
  )
}
