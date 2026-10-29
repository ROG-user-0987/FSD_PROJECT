// Socket.IO server: authenticates the handshake with the access token and puts each
// connection into rooms.
//   user:{id}        personal notifications
//   role:{ROLE}      role-wide events (alerts for managers, dashboard refreshes)
//   warehouse:{id}   stock events. Employees join only their own warehouse; everyone
//                    else joins all warehouses. (Warehouses created later are joined
//                    on the next reconnect.)
// After a token refresh the client reconnects with the new token.
import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { prisma } from '../config/prisma.js'
import type { AuthUser } from '../types/express.js'
import { verifyAccessToken } from '../utils/tokens.js'
import { setIo } from './emit.js'

type SocketData = { user: AuthUser }
type AppSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>

async function joinRooms(socket: AppSocket) {
  const { user } = socket.data
  const rooms = [`user:${user.id}`, `role:${user.role}`]
  if (user.role === 'EMPLOYEE') {
    if (user.warehouseId !== null) rooms.push(`warehouse:${user.warehouseId}`)
  } else {
    const warehouses = await prisma.warehouse.findMany({ select: { id: true } })
    rooms.push(...warehouses.map((warehouse) => `warehouse:${warehouse.id}`))
  }
  await socket.join(rooms)
}

export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
    serveClient: false, // the frontend bundles its own client; do not expose /socket.io/*.js
  })

  // Reject connections without a valid token or with a deactivated account.
  io.use(async (socket: AppSocket, next) => {
    try {
      const { userId } = verifyAccessToken(socket.handshake.auth.token)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          warehouseId: true,
          isActive: true,
        },
      })
      if (!user || !user.isActive) return next(new Error('UNAUTHORIZED'))
      const { isActive: _isActive, ...authUser } = user
      socket.data.user = authUser
      next()
    } catch {
      next(new Error('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket: AppSocket) => {
    joinRooms(socket).catch((err: unknown) => {
      logger.error({ err }, 'Failed to join socket rooms')
      socket.disconnect(true)
    })
  })

  setIo(io)
  return io
}
