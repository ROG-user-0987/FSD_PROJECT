// User management (ADMIN only). There is no public registration.
import bcrypt from 'bcrypt'
import type { Prisma, Role } from '../generated/prisma/client.js'
import { prisma, type Tx } from '../config/prisma.js'
import { disconnectUser } from '../socket/emit.js'
import type { AuthUser } from '../types/express.js'
import { badRequest, conflict, notFound } from '../utils/AppError.js'
import { skipTake } from '../utils/http.js'
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
} from '../validators/user.validators.js'
import { recordAudit } from './audit.service.js'

export const BCRYPT_COST = 12

// Fields that are safe to send to clients (never passwordHash).
export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  warehouseId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  warehouse: { select: { id: true, name: true, code: true } },
} satisfies Prisma.UserSelect

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>

export async function getPublicUser(id: number): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect })
  if (!user) throw notFound('User')
  return user
}

export async function listUsers(query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {
    ...(query.search && {
      OR: [{ name: { contains: query.search } }, { email: { contains: query.search } }],
    }),
    ...(query.role && { role: query.role }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
  }
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: { name: 'asc' },
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.user.count({ where }),
  ])
  return { items, total, page: query.page, pageSize: query.pageSize }
}

async function assertEmailFree(tx: Tx, email: string, exceptUserId?: number) {
  const existing = await tx.user.findUnique({ where: { email }, select: { id: true } })
  if (existing && existing.id !== exceptUserId) {
    throw conflict('EMAIL_TAKEN', 'A user with this email already exists')
  }
}

async function assertWarehouseUsable(tx: Tx, warehouseId: number | null) {
  if (warehouseId === null) return
  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse || !warehouse.isActive) throw badRequest('Warehouse does not exist or is inactive')
}

function assertRoleWarehouse(role: Role, warehouseId: number | null) {
  if ((role === 'EMPLOYEE') !== (warehouseId !== null)) {
    throw badRequest('Employees need a warehouse; other roles must not have one')
  }
}

export async function createUser(actor: AuthUser, input: CreateUserInput): Promise<PublicUser> {
  // Hash BEFORE the transaction: bcrypt takes ~250 ms and SQLite has a single writer,
  // so hashing inside the transaction would block every other write meanwhile.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST)

  return prisma.$transaction(async (tx) => {
    await assertEmailFree(tx, input.email)
    await assertWarehouseUsable(tx, input.warehouseId)
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        warehouseId: input.warehouseId,
        passwordHash,
      },
      select: publicUserSelect,
    })
    await recordAudit(tx, {
      userId: actor.id,
      action: 'user.create',
      entity: 'User',
      entityId: user.id,
      after: user,
    })
    return user
  })
}

export async function updateUser(
  actor: AuthUser,
  id: number,
  input: UpdateUserInput,
): Promise<PublicUser> {
  const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_COST) : undefined

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: publicUserSelect })
    if (!before) throw notFound('User')

    // Admins cannot lock themselves out.
    if (
      actor.id === id &&
      ((input.role && input.role !== before.role) || input.isActive === false)
    ) {
      throw badRequest('You cannot change your own role or deactivate yourself')
    }

    const role = input.role ?? before.role
    // Changing an employee to another role clears the warehouse automatically.
    const warehouseId =
      input.warehouseId !== undefined
        ? input.warehouseId
        : role === 'EMPLOYEE'
          ? before.warehouseId
          : null
    assertRoleWarehouse(role, warehouseId)
    if (input.email) await assertEmailFree(tx, input.email, id)
    if (warehouseId !== before.warehouseId) await assertWarehouseUsable(tx, warehouseId)

    const user = await tx.user.update({
      where: { id },
      data: {
        email: input.email,
        name: input.name,
        role,
        warehouseId,
        isActive: input.isActive,
        passwordHash,
      },
      select: publicUserSelect,
    })

    // A new password or a deactivation logs the user out everywhere.
    if (passwordHash || input.isActive === false) {
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    await recordAudit(tx, {
      userId: actor.id,
      action: input.isActive === false ? 'user.deactivate' : 'user.update',
      entity: 'User',
      entityId: id,
      before,
      after: { ...user, ...(passwordHash && { password: 'changed' }) },
    })
    return user
  })

  // After commit: close any open sockets of a deactivated user.
  if (input.isActive === false) disconnectUser(id)
  return updated
}

export function deactivateUser(actor: AuthUser, id: number): Promise<PublicUser> {
  return updateUser(actor, id, { isActive: false })
}
