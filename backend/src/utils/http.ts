// Response envelope helpers: every success response is { data, meta? }.
// Prisma Decimal values serialise to strings, so money reaches the client as strings.
import type { Response } from 'express'

export function sendData(
  res: Response,
  data: unknown,
  meta?: Record<string, unknown>,
  status = 200,
) {
  res.status(status).json(meta ? { data, meta } : { data })
}

export function sendCreated(res: Response, data: unknown) {
  sendData(res, data, undefined, 201)
}

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }

export function sendPage<T>(res: Response, page: Page<T>) {
  sendData(res, page.items, {
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
  })
}

export function skipTake(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize }
}
