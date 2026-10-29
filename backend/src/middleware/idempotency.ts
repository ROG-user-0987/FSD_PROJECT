// Reads the optional Idempotency-Key header (correctness rule 3).
// The services store it in IdempotencyRecord inside the same DB transaction as the
// change, so a retry replays the original response instead of moving stock twice.
import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../utils/AppError.js'

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,100}$/

export function idempotencyKey(req: Request, _res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key')
  if (key !== undefined) {
    if (!KEY_PATTERN.test(key)) {
      throw badRequest('Idempotency-Key must be 8-100 characters: letters, digits, _ - : .')
    }
    req.idempotencyKey = key
  }
  next()
}
