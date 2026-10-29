// Shared Zod building blocks for request validation.
import { z } from 'zod'

export const idParam = z.object({ id: z.coerce.number().int().positive() })

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
}

export const search = z.string().trim().max(100).optional()
export const optionalId = z.coerce.number().int().positive().optional()
export const order = z.enum(['asc', 'desc']).default('asc')

// Query strings are text: "true"/"false" -> boolean.
export const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true')

// Money arrives as a string so it never passes through a JS float.
export const price = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Use a non-negative amount with up to 2 decimals')
export const cost = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Use a non-negative amount with up to 4 decimals')

export const email = z.string().trim().toLowerCase().pipe(z.email())
export const optionalText = (max: number) => z.string().trim().max(max).optional()

export const role = z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'VIEWER'])
export const stockStatus = z.enum(['in', 'low', 'out'])
