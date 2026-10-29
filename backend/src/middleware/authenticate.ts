// Requires "Authorization: Bearer <access token>". Loads the user on every request,
// so deactivating an account takes effect immediately (cheap with SQLite).
import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../config/prisma.js'
import { unauthorized } from '../utils/AppError.js'
import { verifyAccessToken } from '../utils/tokens.js'

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw unauthorized()

  const { userId } = verifyAccessToken(header.slice('Bearer '.length))
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, warehouseId: true, isActive: true },
  })
  if (!user || !user.isActive) throw unauthorized('ACCOUNT_INACTIVE', 'Account is not active')

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    warehouseId: user.warehouseId,
  }
  next()
}

// For handlers that run after authenticate(): returns req.user as non-null.
export function currentUser(req: Request) {
  if (!req.user) throw unauthorized()
  return req.user
}
