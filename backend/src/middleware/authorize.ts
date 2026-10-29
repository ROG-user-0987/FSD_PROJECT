// Role-based access control. The backend is the source of truth; the frontend only
// hides what a role cannot use. Finer rules ("own warehouse only", "only ADMIN may
// change reorderLevel") are checked in the services.
import type { NextFunction, Request, Response } from 'express'
import type { Role } from '../generated/prisma/client.js'
import { forbidden, unauthorized } from '../utils/AppError.js'

// Role groups used by the routes (permission matrix: see docs/API.md).
export const ROLES = {
  ALL: ['ADMIN', 'MANAGER', 'EMPLOYEE', 'VIEWER'],
  STAFF: ['ADMIN', 'MANAGER', 'EMPLOYEE'], // can move stock
  MANAGERS: ['ADMIN', 'MANAGER'],
  INSIGHTS: ['ADMIN', 'MANAGER', 'VIEWER'], // dashboard and analytics
  ADMIN: ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>

export function authorize(allowed: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized()
    if (!allowed.includes(req.user.role)) throw forbidden()
    next()
  }
}
