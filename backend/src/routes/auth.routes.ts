import { Router } from 'express'
import * as auth from '../controllers/auth.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { loginLimiter, refreshLimiter } from '../middleware/rateLimit.js'
import { trustedOrigin } from '../middleware/trustedOrigin.js'
import { validate } from '../middleware/validate.js'
import { loginBody } from '../validators/auth.validators.js'

export const authRouter = Router()

// The three cookie endpoints only accept requests from our own frontend (CSRF).
authRouter.post('/login', trustedOrigin, loginLimiter, validate({ body: loginBody }), auth.login)
authRouter.post('/refresh', trustedOrigin, refreshLimiter, auth.refresh)
authRouter.post('/logout', trustedOrigin, auth.logout)
authRouter.get('/me', authenticate, auth.me)
