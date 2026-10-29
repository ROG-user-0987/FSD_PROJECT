import { beforeAll, describe, expect, it } from 'vitest'
import { api, setupDatabase } from './helpers.js'

beforeAll(setupDatabase)

describe('health and error envelope', () => {
  it('GET /api/health answers ok', async () => {
    const res = await api().get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')
  })

  it('unknown routes return the error envelope', async () => {
    const res = await api().get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } })
  })

  it('malformed JSON returns 400 INVALID_JSON, not a stack trace', async () => {
    const res = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_JSON')
  })

  it('sets security headers (helmet)', async () => {
    const res = await api().get('/api/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
