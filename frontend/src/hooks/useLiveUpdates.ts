// Turns socket events into TanStack Query cache invalidations (and a few toasts),
// so no page ever needs a manual refresh. Mounted once, in the app layout.
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { queryKeys } from '@/services/queryKeys'
import { getSocket } from '@/services/socket'
import type { AppNotification, TransferStatus } from '@/types/api'
import { useAuth } from './useAuth'

// Socket.IO's own listener type (payloads are untyped on the wire).
type Listener = Parameters<NonNullable<ReturnType<typeof getSocket>>['on']>[1]

export function useLiveUpdates() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  useEffect(() => {
    const socket = getSocket()
    if (!socket || !user) return

    const invalidate = (...keys: QueryKey[]) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
    }

    const handlers: Record<string, Listener> = {
      'inventory:updated': () =>
        invalidate(queryKeys.inventory, queryKeys.products, queryKeys.dashboard),
      'activity:new': () => invalidate(queryKeys.transactions, queryKeys.dashboard),
      'alert:low-stock': () => invalidate(queryKeys.inventory),
      'dashboard:stale': () =>
        invalidate(
          queryKeys.dashboard,
          queryKeys.analytics,
          queryKeys.warehouses,
          queryKeys.forecasts,
        ),
      'transfer:updated': (event: { transferId: number; status: TransferStatus }) => {
        invalidate(queryKeys.transfers)
        toast.info(
          `Transfer #${event.transferId} is now ${event.status.replace('_', ' ').toLowerCase()}`,
        )
      },
      'notification:new': (notification: AppNotification) => {
        invalidate(queryKeys.notifications)
        toast.warning(notification.title, { description: notification.message })
      },
    }

    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler)
    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler)
    }
  }, [queryClient, user])
}
