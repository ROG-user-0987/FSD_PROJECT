import { z } from 'zod'
import { email } from './common.js'

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(200),
})

export type LoginInput = z.infer<typeof loginBody>
