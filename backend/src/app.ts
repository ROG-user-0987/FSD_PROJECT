// Express application (no listening here, so tests can use it with Supertest).
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isProduction } from './config/env.js'
import { logger } from './config/logger.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { apiLimiter } from './middleware/rateLimit.js'
import { apiRouter } from './routes/index.js'

export function createApp() {
  const app = express()

  // In production the API runs behind the host's proxy: trust its first hop so rate
  // limiting sees the real client IP. Locally nothing is trusted, so a spoofed
  // X-Forwarded-For header cannot dodge the login rate limit.
  app.set('trust proxy', isProduction ? 1 : false)

  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  )

  app.use('/api', apiLimiter, apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
