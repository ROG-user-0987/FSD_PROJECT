import type { CookieOptions, Request, Response } from 'express'
import { isProduction } from '../config/env.js'
import { currentUser } from '../middleware/authenticate.js'
import * as authService from '../services/auth.service.js'
import { getPublicUser } from '../services/user.service.js'
import { sendData } from '../utils/http.js'
import { ACCESS_TOKEN_TTL_SECONDS } from '../utils/tokens.js'
import type { LoginInput } from '../validators/auth.validators.js'

const REFRESH_COOKIE = 'inventoryos_rt'

// httpOnly: JavaScript cannot read it. Secure + SameSite=None in production because the
// frontend (Vercel) and the API live on different domains; Lax over http in development.
// Path limits the cookie to the auth endpoints.
function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth',
    ...(expires && { expires }),
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE]
  return typeof value === 'string' ? value : undefined
}

function sendSession(res: Response, result: authService.AuthResult) {
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(result.refreshExpiresAt))
  sendData(res, {
    accessToken: result.accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: result.user,
  })
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput
  sendSession(res, await authService.login(email, password))
}

export async function refresh(req: Request, res: Response) {
  try {
    sendSession(res, await authService.refresh(readRefreshCookie(req)))
  } catch (error) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions())
    throw error
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(readRefreshCookie(req))
  res.clearCookie(REFRESH_COOKIE, cookieOptions())
  sendData(res, { loggedOut: true })
}

export async function me(req: Request, res: Response) {
  sendData(res, await getPublicUser(currentUser(req).id))
}
