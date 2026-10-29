// Remembers which product x warehouse rows changed in the last few seconds (from the
// `inventory:updated` socket event), so tables can briefly highlight them.
import { useEffect, useState } from 'react'
import { getSocket } from '@/services/socket'

export const pairKey = (productId: number, warehouseId: number) => `${productId}:${warehouseId}`

export function useInventoryFlash(durationMs = 2500) {
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const onUpdate = (event: { productId: number; warehouseId: number }) => {
      const key = pairKey(event.productId, event.warehouseId)
      setFlashing((current) => new Set(current).add(key))
      timers.push(
        setTimeout(() => {
          setFlashing((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        }, durationMs),
      )
    }
    socket.on('inventory:updated', onUpdate)
    return () => {
      socket.off('inventory:updated', onUpdate)
      timers.forEach(clearTimeout)
    }
  }, [durationMs])

  return flashing
}
