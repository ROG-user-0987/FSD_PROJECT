// Security checks: password hashing, data isolation between users, form validation
// (mass assignment, limits), CSRF origin check, no sensitive fields in responses.
import bcrypt from 'bcrypt'
import { beforeAll, describe, expect, it } from 'vitest'
import { api, createUser, loginAs, PASSWORD, prisma, setupDatabase } from './helpers.js'

let admin: Awaited<ReturnType<typeof loginAs>>
const asAdmin = () => ({ Authorization: `Bearer ${admin.token}` })

beforeAll(async () => {
  await setupDatabase()
  admin = await loginAs('ADMIN')
})

describe('password hashing', () => {
  it('stores bcrypt hashes (cost 12), never the password', async () => {
    const res = await api().post('/api/users').set(asAdmin()).send({
      email: 'hash-check@test.local',
      name: 'Hash Check',
      role: 'VIEWER',
      password: PASSWORD,
    })
    expect(res.status).toBe(201)

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: 'hash-check@test.local' },
    })
    expect(stored.passwordHash).toMatch(/^\$2b\$12\$/)
    expect(stored.passwordHash).not.toContain(PASSWORD)
    expect(await bcrypt.compare(PASSWORD, stored.passwordHash)).toBe(true)
  })

  it('stores refresh tokens only as SHA-256 hashes', async () => {
    const { cookie, user } = await loginAs('VIEWER')
    const raw = cookie!.split('=')[1]!
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } })
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) {
      expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(token.tokenHash).not.toBe(raw)
    }
  })

  it('rejects passwords bcrypt would silently truncate (> 72 bytes)', async () => {
    const res = await api()
      .post('/api/users')
      .set(asAdmin())
      .send({ email: 'long-pw@test.local', name: 'Long', role: 'VIEWER', password: 'a'.repeat(73) })
    expect(res.status).toBe(400)
  })
})

describe('no sensitive fields leave the API', () => {
  it('user listings and the audit log never contain password hashes', async () => {
    const users = await api().get('/api/users').set(asAdmin())
    expect(users.status).toBe(200)
    expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|\$2b\$/)

    const audit = await api().get('/api/admin/audit-log').set(asAdmin())
    expect(audit.status).toBe(200)
    expect(JSON.stringify(audit.body)).not.toMatch(/passwordHash|\$2b\$/)
  })
})

describe('forms: validation and mass assignment', () => {
  it('ignores fields a form is not allowed to set', async () => {
    const res = await api().post('/api/users').set(asAdmin()).send({
      email: 'mass-assign@test.local',
      name: 'Mass Assign',
      role: 'VIEWER',
      password: PASSWORD,
      passwordHash: 'attacker-chosen',
      isActive: false,
      id: 999_999,
    })
    expect(res.status).toBe(201)
    expect(res.body.data.id).not.toBe(999_999)
    expect(res.body.data.isActive).toBe(true)

    const login = await api()
      .post('/api/auth/login')
      .send({ email: 'mass-assign@test.local', password: PASSWORD })
    expect(login.status).toBe(200)
  })

  it('rejects wrong types and oversized input with VALIDATION_ERROR', async () => {
    const bodies = [
      { email: 'x@test.local', name: 'X', role: 'SUPERUSER', password: PASSWORD }, // unknown role
      { email: 'not-an-email', name: 'X', role: 'VIEWER', password: PASSWORD },
      { email: 'x@test.local', name: 'x'.repeat(101), role: 'VIEWER', password: PASSWORD },
      { email: 'x@test.local', name: 'X', role: 'VIEWER', password: 'short' },
      [], // not an object
    ]
    for (const body of bodies) {
      const res = await api().post('/api/users').set(asAdmin()).send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects request bodies over 100 kB', async () => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email: 'a@test.local', password: 'x'.repeat(150_000) })
    expect(res.status).toBe(413)
  })
})

describe('users only see their own data', () => {
  it('a user cannot read or mark another user’s notifications', async () => {
    const alice = await loginAs('MANAGER')
    const bob = await loginAs('MANAGER')
    const note = await prisma.$transaction((tx) =>
      tx.notification.create({
        data: { userId: alice.user.id, type: 'LOW_STOCK', title: 'Private', message: 'For Alice' },
      }),
    )

    const bobList = await api()
      .get('/api/notifications')
      .set('Authorization', `Bearer ${bob.token}`)
    expect(bobList.body.data.map((n: { id: number }) => n.id)).not.toContain(note.id)

    const bobMark = await api()
      .put(`/api/notifications/${note.id}/read`)
      .set('Authorization', `Bearer ${bob.token}`)
    expect(bobMark.status).toBe(404)
    const unchanged = await prisma.notification.findUniqueOrThrow({ where: { id: note.id } })
    expect(unchanged.readAt).toBeNull()

    const aliceList = await api()
      .get('/api/notifications')
      .set('Authorization', `Bearer ${alice.token}`)
    expect(aliceList.body.data.map((n: { id: number }) => n.id)).toContain(note.id)
  })

  it('/auth/me always returns the caller, whatever id is sent', async () => {
    const viewer = await loginAs('VIEWER')
    const res = await api().get('/api/auth/me?id=1').set('Authorization', `Bearer ${viewer.token}`)
    expect(res.body.data.id).toBe(viewer.user.id)
  })

  it('non-admins cannot list users or open the admin tools', async () => {
    for (const role of ['MANAGER', 'EMPLOYEE', 'VIEWER'] as const) {
      const { token } = await loginAs(role)
      const auth = { Authorization: `Bearer ${token}` }
      expect((await api().get('/api/users').set(auth)).status).toBe(403)
      expect((await api().get('/api/admin/audit-log').set(auth)).status).toBe(403)
      expect((await api().get('/api/admin/consistency-check').set(auth)).status).toBe(403)
    }
  })
})

describe('CSRF: cookie endpoints only accept our own origin', () => {
  it('rejects login, refresh and logout from another website', async () => {
    const user = await createUser('VIEWER')
    const evil = { Origin: 'https://evil.example' }
    const login = await api()
      .post('/api/auth/login')
      .set(evil)
      .send({ email: user.email, password: PASSWORD })
    expect(login.status).toBe(403)
    expect((await api().post('/api/auth/refresh').set(evil)).status).toBe(403)
    expect((await api().post('/api/auth/logout').set(evil)).status).toBe(403)
  })

  it('accepts the configured frontend origin', async () => {
    const user = await createUser('VIEWER')
    const res = await api()
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: user.email, password: PASSWORD })
    expect(res.status).toBe(200)
  })
})

describe('no debug output', () => {
  it('errors never expose stack traces or internals', async () => {
    const res = await api().get('/api/users/not-a-number').set(asAdmin())
    expect(JSON.stringify(res.body)).not.toMatch(/at .+\.(ts|js):\d+|node_modules|stack/i)
  })
})
