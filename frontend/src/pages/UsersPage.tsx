import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
import type { User } from '@/types/api'
import { formatDate } from '@/utils/format'
import { ROLE_LABELS } from '@/utils/permissions'

// TODO(phase 1 polish): create/edit dialog, deactivate with confirmation, search, paging.
export function UsersPage() {
  const query = useQuery({
    queryKey: [...queryKeys.users, { pageSize: 100 }],
    queryFn: () => api.page<User>('/users', { pageSize: 100 }),
  })

  return (
    <>
      <PageHeader title="Users" description="People who can sign in to InventoryOS." />
      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState icon={Users} title="No users yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {user.warehouse?.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? 'outline' : 'destructive'}>
                        {user.isActive ? 'Active' : 'Deactivated'}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDate(user.createdAt)}
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
