import { createHash, randomBytes } from 'node:crypto'

// 256-bit random token, URL-safe. Used for refresh tokens.
export const randomToken = () => randomBytes(32).toString('base64url')

// SHA-256 hex digest. A fast hash is fine for high-entropy random tokens; bcrypt is
// only needed for human-chosen passwords.
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// Stable hash of a JSON payload (object keys sorted), for idempotency checks.
export function hashPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  )
  return sha256(canonical ?? 'null')
}
