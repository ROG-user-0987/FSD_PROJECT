// Login, refresh-token rotation, logout.
//
// Access token: 15-minute JWT, kept in memory by the frontend.
// Refresh token: random opaque string in an httpOnly cookie; only its SHA-256 hash is
// stored. Every refresh revokes the presented token and issues a new one (rotation).
// If an already-revoked token is presented, it was probably stolen and replayed, so
// every refresh token of that user is revoked (reuse detection).
import bcrypt from 'bcrypt'
import { env } from '../config/env.js'
import { prisma, type Tx } from '../config/prisma.js'
import { unauthorized } from '../utils/AppError.js'
import { randomToken, sha256 } from '../utils/crypto.js'
import { signAccessToken } from '../utils/tokens.js'
import { BCRYPT_COST, getPublicUser, type PublicUser } from './user.service.js'

export type AuthResult = {
  accessToken: string
  refreshToken: string
  refreshExpiresAt: Date
  user: PublicUser
}

const invalidCredentials = () => unauthorized('INVALID_CREDENTIALS', 'Invalid email or password')
const invalidRefresh = () =>
  unauthorized('REFRESH_TOKEN_INVALID', 'Session expired, please log in again')

// Compared against when the email does not exist, so the response takes the same
// time either way (does not reveal which emails have accounts).
let dummyHash: Promise<string> | undefined
const getDummyHash = () => (dummyHash ??= bcrypt.hash('timing-equaliser', BCRYPT_COST))

async function issueRefreshToken(tx: Tx, userId: number) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  await tx.refreshToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } })
  return { token, expiresAt }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email } })
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()))
  // Same error for unknown email, wrong password and deactivated account.
  if (!user || !passwordOk || !user.isActive) throw invalidCredentials()

  const refresh = await prisma.$transaction((tx) => issueRefreshToken(tx, user.id))
  return {
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    user: await getPublicUser(user.id),
  }
}

export async function refresh(rawToken: string | undefined): Promise<AuthResult> {
  if (!rawToken) throw invalidRefresh()
  const tokenHash = sha256(rawToken)

  // The transaction returns an outcome instead of throwing for "reuse": throwing
  // would roll back the revocation we want to keep.
  const outcome = await prisma.$transaction(async (tx) => {
    const stored = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })
    if (!stored || stored.expiresAt <= new Date()) return { kind: 'invalid' as const }

    const revokeAll = () =>
      tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

    if (stored.revokedAt) {
      await revokeAll()
      return { kind: 'reused' as const }
    }
    if (!stored.user.isActive) {
      await revokeAll()
      return { kind: 'invalid' as const }
    }

    // Conditional update: only one request can rotate a given token.
    const rotated = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (rotated.count === 0) return { kind: 'reused' as const }

    const next = await issueRefreshToken(tx, stored.userId)
    return { kind: 'ok' as const, user: stored.user, next }
  })

  if (outcome.kind !== 'ok') throw invalidRefresh()
  return {
    accessToken: signAccessToken(outcome.user),
    refreshToken: outcome.next.token,
    refreshExpiresAt: outcome.next.expiresAt,
    user: await getPublicUser(outcome.user.id),
  }
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return
  await prisma.$transaction((tx) =>
    tx.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  )
}
