// Socket.IO client. Connects after login with the in-memory access token and
// reconnects with the fresh token after every refresh.
import { io, type Socket } from 'socket.io-client'
import { refreshSession } from './api'

const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? 'http://localhost:4000'

let socket: Socket | null = null

export function getSocket() {
  return socket
}

export function connectSocket(token: string) {
  if (socket) {
    // Same connection, new credentials (after a token refresh).
    socket.auth = { token }
    if (socket.connected) socket.disconnect()
    socket.connect()
    return socket
  }

  socket = io(SOCKET_URL, { auth: { token }, withCredentials: true })

  // The token may have expired while the tab slept: refresh once, then reconnect.
  // (refreshSession notifies the auth context, which calls connectSocket again.)
  socket.on('connect_error', (error) => {
    if (error.message === 'UNAUTHORIZED') void refreshSession()
  })
  return socket
}

export function disconnectSocket() {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
}
