import type { Request, Response } from 'express'
import { currentUser } from '../middleware/authenticate.js'
import * as userService from '../services/user.service.js'
import { sendCreated, sendData, sendPage } from '../utils/http.js'
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
} from '../validators/user.validators.js'
import { idParam, parsedQuery } from './helpers.js'

export async function list(req: Request, res: Response) {
  sendPage(res, await userService.listUsers(parsedQuery<ListUsersQuery>(req)))
}

export async function create(req: Request, res: Response) {
  sendCreated(res, await userService.createUser(currentUser(req), req.body as CreateUserInput))
}

export async function update(req: Request, res: Response) {
  sendData(
    res,
    await userService.updateUser(currentUser(req), idParam(req), req.body as UpdateUserInput),
  )
}

export async function deactivate(req: Request, res: Response) {
  sendData(res, await userService.deactivateUser(currentUser(req), idParam(req)))
}
