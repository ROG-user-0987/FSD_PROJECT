import { beforeAll, describe, expect, it } from 'vitest'
import {
  api,
  createUser,
  loginAs,
  PASSWORD,
  prisma,
  refreshCookie,
  setupDatabase,
} from './helpers.js'

beforeAll(setupDatabase)

describe('login', () => {
  it('returns an access token, the user and an httpOnly refresh cookie', async () => {
    const user = await createUser('MANAGER')
    const res = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toEqual(expect.any(String))
    expect(res.body.data.user).toMatchObject({ id: user.id, email: user.email, role: 'MANAGER' })
    expect(res.body.data.user.passwordHash).toBeUndefined()

    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';')
    expect(cookie).toMatch(/inventoryos_rt=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Path=\/api\/auth/)
  })

  it('accepts the email in any letter case', async () => {
    const user = await createUser('VIEWER')
    const res = await api()
      .post('/api/auth/login')
      .send({ email: user.email.toUpperCase(), password: PASSWORD })
    expect(res.status).toBe(200)
  })

  it('gives the same error for a wrong password, an unknown email and a deactivated user', async () => {
    const user = await createUser('MANAGER')
    const inactive = await createUser('MANAGER', { isActive: false })
    const attempts = [
      { email: user.email, password: 'wrong-password' },
      { email: 'nobody@test.local', password: PASSWORD },
      { email: inactive.email, password: PASSWORD },
    ]
    for (const body of attempts) {
      const res = await api().post('/api/auth/login').send(body)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    }
  })

  it('validates the request body', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('me', () => {
  it('returns the current user with a valid token', async () => {
    const { user, token } = await loginAs('EMPLOYEE')
    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: user.id, warehouseId: user.warehouseId })
  })

  it('rejects missing and invalid tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401)
    const res = await api().get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('TOKEN_INVALID')
  })
})

describe('refresh token rotation', () => {
  it('issues a new refresh token and rejects the old one', async () => {
    const { cookie } = await loginAs('MANAGER')
    const first = await api().post('/api/auth/refresh').set('Cookie', cookie!)
    expect(first.status).toBe(200)
    expect(first.body.data.accessToken).toEqual(expect.any(String))
    const rotated = refreshCookie(first)
    expect(rotated).toBeDefined()
    expect(rotated).not.toBe(cookie)

    // Replaying the old token = reuse: rejected, and every session of the user is revoked.
    const replay = await api().post('/api/auth/refresh').set('Cookie', cookie!)
    expect(replay.status).toBe(401)
    const afterReuse = await api().post('/api/auth/refresh').set('Cookie', rotated!)
    expect(afterReuse.status).toBe(401)
  })

  it('rejects a request without a cookie', async () => {
    const res = await api().post('/api/auth/refresh')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID')
  })

  it('logout revokes the refresh token', async () => {
    const { cookie } = await loginAs('VIEWER')
    expect((await api().post('/api/auth/logout').set('Cookie', cookie!)).status).toBe(200)
    expect((await api().post('/api/auth/refresh').set('Cookie', cookie!)).status).toBe(401)
  })
})

describe('deactivation', () => {
  it('takes effect immediately: access token and refresh token stop working', async () => {
    const admin = await loginAs('ADMIN')
    const target = await loginAs('EMPLOYEE')

    const res = await api()
      .put(`/api/users/${target.user.id}/deactivate`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.isActive).toBe(false)

    expect(
      (await api().get('/api/auth/me').set('Authorization', `Bearer ${target.token}`)).status,
    ).toBe(401)
    expect((await api().post('/api/auth/refresh').set('Cookie', target.cookie!)).status).toBe(401)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.deactivate', entityId: String(target.user.id) },
    })
    expect(audit?.userId).toBe(admin.user.id)
  })

  it('an admin cannot deactivate themselves', async () => {
    const admin = await loginAs('ADMIN')
    const res = await api()
      .put(`/api/users/${admin.user.id}/deactivate`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(400)
  })
})

describe('user management', () => {
  it('admin creates an employee, who must have a warehouse', async () => {
    const admin = await loginAs('ADMIN')
    const employee = await loginAs('EMPLOYEE') // only to get an existing warehouse id
    const auth = { Authorization: `Bearer ${admin.token}` }

    const missingWarehouse = await api()
      .post('/api/users')
      .set(auth)
      .send({ email: 'new-emp@test.local', name: 'New', role: 'EMPLOYEE', password: PASSWORD })
    expect(missingWarehouse.status).toBe(400)

    const created = await api().post('/api/users').set(auth).send({
      email: 'New-Emp@Test.local',
      name: 'New Employee',
      role: 'EMPLOYEE',
      password: PASSWORD,
      warehouseId: employee.user.warehouseId,
    })
    expect(created.status).toBe(201)
    expect(created.body.data.email).toBe('new-emp@test.local')

    const duplicate = await api().post('/api/users').set(auth).send({
      email: 'new-emp@test.local',
      name: 'Again',
      role: 'VIEWER',
      password: PASSWORD,
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('EMAIL_TAKEN')
  })
})
