// Environment variables, validated once at startup. The app refuses to start
// (fail fast) when something is missing or malformed.
import { existsSync } from 'node:fs'
import { z } from 'zod'

// Node's built-in .env loader. Variables that are already set (by Vitest or by
// the hosting platform) are NOT overwritten.
if (existsSync('.env')) process.loadEnvFile('.env')

// Empty values in .env (e.g. 'SEED_DEMO_PASSWORD=') count as not set.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const EnvSchema = z.object({
  // Fail-safe default: without an explicit NODE_ENV the app runs in production mode
  // (Secure cookies, JSON logs, no debug output). .env sets "development" locally.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().startsWith('file:', 'DATABASE_URL must be a SQLite file: URL'),
  // One origin, or several separated by commas.
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SEED_ADMIN_EMAIL: optional(z.email()),
  SEED_ADMIN_PASSWORD: optional(z.string().min(10).max(72)),
  SEED_ADMIN_NAME: optional(z.string().min(1)),
  // Shared password of the demo users the seed creates (managers, employees, viewer).
  SEED_DEMO_PASSWORD: optional(z.string().min(10).max(72)),
})

const parsed = EnvSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error))
  process.exit(1)
}

// Production must never run with example values or plain-http origins.
function productionProblems(config: z.infer<typeof EnvSchema>): string[] {
  if (config.NODE_ENV !== 'production') return []
  const problems: string[] = []
  if (config.JWT_ACCESS_SECRET.startsWith('replace-with')) {
    problems.push('JWT_ACCESS_SECRET is still the example value from .env.example')
  }
  for (const origin of config.CORS_ORIGIN) {
    if (!origin.startsWith('https://')) problems.push(`CORS_ORIGIN "${origin}" must use https`)
  }
  return problems
}

const problems = productionProblems(parsed.data)
if (problems.length > 0) {
  console.error('Refusing to start in production:\n- ' + problems.join('\n- '))
  process.exit(1)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'
