import { z } from 'zod'
import { booleanQuery, email, pagination, role, search } from './common.js'

// bcrypt only uses the first 72 bytes of a password; anything longer would be cut off
// silently, so longer passwords are rejected instead.
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes')
const name = z.string().trim().min(1).max(100)
const warehouseId = z.number().int().positive().nullable()

export const listUsersQuery = z.object({
  ...pagination,
  search,
  role: role.optional(),
  isActive: booleanQuery.optional(),
})

export const createUserBody = z
  .object({ email, name, role, password, warehouseId: warehouseId.default(null) })
  .refine((user) => (user.role === 'EMPLOYEE') === (user.warehouseId !== null), {
    message: 'Employees need a warehouse; other roles must not have one',
    path: ['warehouseId'],
  })

// All fields optional. The employee/warehouse rule is checked in the service,
// because it depends on the user's current role and warehouse.
export const updateUserBody = z
  .object({
    email: email.optional(),
    name: name.optional(),
    role: role.optional(),
    password: password.optional(),
    warehouseId: warehouseId.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' })

export type ListUsersQuery = z.infer<typeof listUsersQuery>
export type CreateUserInput = z.infer<typeof createUserBody>
export type UpdateUserInput = z.infer<typeof updateUserBody>
