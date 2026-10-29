// Bell with an unread badge and a dropdown of recent notifications (no separate page).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { request, api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { AppNotification } from '@/types/api'
import { cn } from '@/lib/utils'
import { formatRelative } from '@/utils/format'

export function NotificationBell() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => request<AppNotification[]>('/notifications', { query: { pageSize: 10 } }),
  })
  const items = data?.data ?? []
  const unread = Number(data?.meta?.unread ?? 0)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
  const markRead = useMutation({
    mutationFn: (id: number) => api.put(`/notifications/${id}/read`),
    onSuccess: invalidate,
  })
  const markAllRead = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: invalidate,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between pr-1">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        ) : (
          items.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="flex flex-col items-start gap-0.5"
              onSelect={() => !notification.readAt && markRead.mutate(notification.id)}
            >
              <span className={cn('text-sm', !notification.readAt && 'font-medium')}>
                {notification.title}
              </span>
              <span className="text-xs text-muted-foreground">{notification.message}</span>
              <span className="text-[11px] text-muted-foreground">
                {formatRelative(notification.createdAt)}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
