// Socket.IO handshake authentication and live events.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as connect } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initSocket } from '../src/socket/index.js'
import { setIo } from '../src/socket/emit.js'
import { app, bearer, api, createProduct, loginAs, prisma, setupDatabase } from './helpers.js'

let server: http.Server
let url: string

beforeAll(async () => {
  await setupDatabase()
  server = http.createServer(app)
  initSocket(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  url = `http://localhost:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  setIo(null)
  await new Promise((resolve) => server.close(resolve))
})

function tryConnect(token: unknown) {
  return new Promise<'connected' | string>((resolve) => {
    const socket = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false })
    socket.on('connect', () => {
      socket.close()
      resolve('connected')
    })
    socket.on('connect_error', (error) => {
      socket.close()
      resolve(error.message)
    })
  })
}

describe('socket handshake', () => {
  it('rejects missing and invalid tokens', async () => {
    expect(await tryConnect(undefined)).toBe('UNAUTHORIZED')
    expect(await tryConnect('not-a-jwt')).toBe('UNAUTHORIZED')
  })

  it('accepts a valid token and rejects it once the user is deactivated', async () => {
    const viewer = await loginAs('VIEWER')
    expect(await tryConnect(viewer.token)).toBe('connected')
    await prisma.$transaction((tx) =>
      tx.user.update({ where: { id: viewer.user.id }, data: { isActive: false } }),
    )
    expect(await tryConnect(viewer.token)).toBe('UNAUTHORIZED')
  })

  it('pushes inventory:updated to the warehouse room after a stock change', async () => {
    const employee = await loginAs('EMPLOYEE')
    const product = await createProduct()
    const socket = connect(url, {
      auth: { token: employee.token },
      transports: ['websocket'],
      reconnection: false,
    })
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 100)) // rooms are joined right after connect

    const event = new Promise<{ productId: number; newQuantity: number }>((resolve) =>
      socket.on('inventory:updated', resolve),
    )
    const res = await api()
      .post('/api/inventory/stock-in')
      .set(bearer(employee.token))
      .send({ productId: product.id, warehouseId: employee.user.warehouseId, quantity: 4 })
    expect(res.status).toBe(201)
    expect(await event).toMatchObject({ productId: product.id, newQuantity: 4 })
    socket.close()
  })
})
