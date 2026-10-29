// Server-driven table: TanStack Table renders the rows, the API does paging, sorting
// and filtering (manualPagination). The footer shows the range and page buttons.
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { PageMeta } from '@/types/api'
import { formatNumber } from '@/utils/format'

type Props<T> = {
  // TValue varies per column, so the columns array is typed loosely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  data: T[] | undefined
  meta?: PageMeta
  isLoading?: boolean
  isFetching?: boolean
  empty?: ReactNode
  onPageChange?: (page: number) => void
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  getRowId?: (row: T) => string
}

export function DataTable<T>({
  columns,
  data,
  meta,
  isLoading,
  isFetching,
  empty,
  onPageChange,
  onRowClick,
  rowClassName,
  getRowId,
}: Props<T>) {
  const table = useReactTable({
    data: data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId,
  })

  if (!isLoading && data && data.length === 0 && empty) return <>{empty}</>

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className={cn('transition-opacity', isFetching && !isLoading && 'opacity-60')}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="bg-muted/40 hover:bg-muted/40">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'h-10 text-xs uppercase tracking-wide',
                      header.column.columnDef.meta?.className,
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i}>
                    {columns.map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      'transition-colors duration-700',
                      onRowClick && 'cursor-pointer',
                      rowClassName?.(row.original),
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      {meta && onPageChange && (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-sm text-muted-foreground">
          <span>
            {meta.total === 0
              ? 'No results'
              : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(meta.total)}`}
          </span>
          <div className="flex items-center gap-1">
            <span className="mr-2 hidden sm:inline">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={meta.page <= 1}
              onClick={() => onPageChange(meta.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={meta.page >= meta.totalPages}
              onClick={() => onPageChange(meta.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
