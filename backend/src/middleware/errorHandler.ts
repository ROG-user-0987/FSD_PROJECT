// Turns every error into the error envelope. Clients never see stack traces or
// internal messages; the details are logged server-side.
import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '../generated/prisma/client.js'
import { AppError } from '../utils/AppError.js'
import { triggerMessage } from '../utils/dbErrors.js'

function send(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ error: { code, message, ...(details !== undefined && { details }) } })
}

export function notFoundHandler(req: Request, res: Response) {
  send(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`)
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500 && err.status !== 501) req.log.error({ err }, err.message)
    return send(res, err.status, err.code, err.message, err.details)
  }

  // Request-body errors from express.json(): malformed JSON, body over the size limit,
  // unsupported encoding. They carry a 4xx status and are the client's fault.
  if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    return send(res, 400, 'INVALID_JSON', 'Request body is not valid JSON')
  }
  const status = typeof err === 'object' && err !== null && 'status' in err ? err.status : undefined
  if (status === 413) return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return send(res, status, 'BAD_REQUEST', 'The request could not be processed')
  }

  // A database guard (trigger) fired: a bug let invalid data reach the database.
  // Checked before P2003, because the adapter reports trigger aborts with that code.
  const guardMessage = triggerMessage(err)
  if (guardMessage !== null) {
    req.log.error({ err, guardMessage }, 'Database guard rejected a write')
    return send(res, 409, 'CONSTRAINT_VIOLATION', 'The change violates a data rule')
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return send(res, 409, 'ALREADY_EXISTS', 'A record with this value already exists')
    }
    if (err.code === 'P2003') {
      return send(res, 409, 'IN_USE', 'This record is referenced by other records')
    }
    if (err.code === 'P2025') return send(res, 404, 'NOT_FOUND', 'Record not found')
  }

  req.log.error({ err }, 'Unhandled error')
  send(res, 500, 'INTERNAL_ERROR', 'Something went wrong')
}
