// Access tokens: short-lived (15 min) HS256 JWTs. The frontend keeps them in memory only.
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { env } from '../config/env.js'
import type { Role } from '../generated/prisma/client.js'
import { AppError } from './AppError.js'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

const PayloadSchema = z.object({
  sub: z.string().regex(/^\d+$/),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'VIEWER']),
})

export function signAccessToken(user: { id: number; role: Role }): string {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: String(user.id),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  })
}

export function verifyAccessToken(token: unknown): { userId: number; role: Role } {
  if (typeof token !== 'string' || token.length === 0) {
    throw new AppError('TOKEN_INVALID', 401, 'Invalid access token')
  }
  try {
    const payload = PayloadSchema.parse(
      jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }),
    )
    return { userId: Number(payload.sub), role: payload.role }
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('TOKEN_EXPIRED', 401, 'Access token expired')
    }
    throw new AppError('TOKEN_INVALID', 401, 'Invalid access token')
  }
}
