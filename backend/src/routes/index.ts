// All API routes, mounted under /api.
// Layering: routes -> controllers (thin) -> services (business logic) -> Prisma.
import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { sendData } from '../utils/http.js'
import { authRouter } from './auth.routes.js'
import { categoryRouter, productRouter, supplierRouter, warehouseRouter } from './catalog.routes.js'
import {
  adminRouter,
  analyticsRouter,
  dashboardRouter,
  forecastRouter,
  notificationRouter,
} from './insights.routes.js'
import { inventoryRouter, transactionRouter, transferRouter } from './stock.routes.js'
import { userRouter } from './user.routes.js'

export const apiRouter = Router()

// Health check for the hosting platform; also proves the database answers.
apiRouter.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`
  sendData(res, { status: 'ok', time: new Date().toISOString() })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/users', userRouter)
apiRouter.use('/categories', categoryRouter)
apiRouter.use('/suppliers', supplierRouter)
apiRouter.use('/warehouses', warehouseRouter)
apiRouter.use('/products', productRouter)
apiRouter.use('/inventory', inventoryRouter)
apiRouter.use('/transactions', transactionRouter)
apiRouter.use('/transfers', transferRouter)
apiRouter.use('/notifications', notificationRouter)
apiRouter.use('/dashboard', dashboardRouter)
apiRouter.use('/analytics', analyticsRouter)
apiRouter.use('/forecasts', forecastRouter)
apiRouter.use('/admin', adminRouter)
