import { Router } from 'express'
import * as users from '../controllers/user.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize, ROLES } from '../middleware/authorize.js'
import { validate } from '../middleware/validate.js'
import { idParam } from '../validators/common.js'
import { createUserBody, listUsersQuery, updateUserBody } from '../validators/user.validators.js'

export const userRouter = Router()

userRouter.use(authenticate, authorize(ROLES.ADMIN))

userRouter.get('/', validate({ query: listUsersQuery }), users.list)
userRouter.post('/', validate({ body: createUserBody }), users.create)
userRouter.put('/:id', validate({ params: idParam, body: updateUserBody }), users.update)
userRouter.put('/:id/deactivate', validate({ params: idParam }), users.deactivate)
