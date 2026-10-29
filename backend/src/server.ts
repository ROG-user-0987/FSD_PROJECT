// Entry point: database setup, HTTP server, Socket.IO, graceful shutdown.
import http from 'node:http'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { initDatabase, prisma } from './config/prisma.js'
import { initSocket } from './socket/index.js'

await initDatabase()

const server = http.createServer(createApp())
const io = initSocket(server)

server.listen(env.PORT, () => {
  logger.info(`InventoryOS API listening on http://localhost:${env.PORT}/api`)
})

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`)
  await io.close() // also closes the HTTP server
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
