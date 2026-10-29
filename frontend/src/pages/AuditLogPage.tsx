import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ScrollText, XCircle } from 'lucide-react'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { AuditEntry, ConsistencyReport } from '@/types/api'
import { formatDateTime, formatNumber } from '@/utils/format'

function ConsistencyCard() {
  const query = useQuery({
    queryKey: queryKeys.consistency,
    queryFn: () => api.get<ConsistencyReport>('/admin/consistency-check'),
  })
  const report = query.data

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Ledger consistency</CardTitle>
          <CardDescription>
            Every stock quantity must equal the sum of its transactions.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Run check
        </Button>
      </CardHeader>
      <CardContent>
        {query.isError ? (
          <p className="text-sm text-destructive">Could not run the check.</p>
        ) : !report ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : report.ok ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" />
            All {formatNumber(report.checkedPairs)} stock records match the ledger.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            {report.mismatches.length} mismatches found.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// TODO(phase 4): filters (entity, user), pagination, before/after diff drawer.
export function AuditLogPage() {
  const query = useQuery({
    queryKey: [...queryKeys.auditLog, { pageSize: 50 }],
    queryFn: () => api.page<AuditEntry>('/admin/audit-log', { pageSize: 50 }),
  })

  return (
    <>
      <PageHeader title="Audit log" description="Changes to users, products and warehouses." />
      <ConsistencyCard />
      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState icon={ScrollText} title="No changes recorded yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>{entry.user.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{entry.action}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.entity} #{entry.entityId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  )
}
