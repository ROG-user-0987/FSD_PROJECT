// Adds the authenticated user and the idempotency key to Express requests.
import type { Role } from '../generated/prisma/client.js'

export type AuthUser = {
  id: number
  email: string
  name: string
  role: Role
  warehouseId: number | null
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      idempotencyKey?: string
    }
  }
}
