// CSRF protection for the endpoints that read or set the refresh-token cookie.
//
// In production the cookie must be SameSite=None (frontend and API are on different
// domains), so a malicious site could make the victim's browser send it. Browsers always
// attach an Origin header to cross-site POST requests: anything that is not our frontend
// is rejected. Requests without an Origin (curl, tests) carry no browser cookies to abuse.
import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { forbidden } from '../utils/AppError.js'

export function trustedOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.headers.origin
  if (origin !== undefined && !env.CORS_ORIGIN.includes(origin)) {
    throw forbidden('Request origin is not allowed')
  }
  next()
}
