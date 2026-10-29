// Rate limits: generous for the whole API, strict for login and refresh
// (slows down password guessing). Disabled in tests.
import { rateLimit } from 'express-rate-limit'
import { env } from '../config/env.js'

function limiter(windowMinutes: number, limit: number) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
      })
    },
  })
}

export const apiLimiter = limiter(1, 300)
export const loginLimiter = limiter(15, 10)
export const refreshLimiter = limiter(15, 60)
