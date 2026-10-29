// Small fetch wrapper for the InventoryOS API.
//
// - The access token lives in memory only (never localStorage), so a script injected
//   into the page cannot steal a long-lived credential.
// - The refresh token is an httpOnly cookie the browser sends to /api/auth/*.
// - On a 401 the client refreshes once and retries the request.
// - Refreshes are "single-flight": concurrent callers share one /auth/refresh request.
//   This matters: refresh tokens rotate, and sending the same token twice looks like
//   token theft to the server, which then logs the user out everywhere.
import type { ApiEnvelope, ApiErrorBody, Session } from '@/types/api'

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------- Session state

let accessToken: string | null = null
type SessionListener = (session: Session | null) => void
const listeners = new Set<SessionListener>()

export function getAccessToken() {
  return accessToken
}

function setSession(session: Session | null) {
  accessToken = session?.accessToken ?? null
  for (const listener of listeners) listener(session)
}

// Notified after login, every refresh and logout (the socket reconnects with the new token).
export function onSessionChange(listener: SessionListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------- Requests

type Query = Record<string, string | number | boolean | null | undefined>

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Query
  idempotencyKey?: string
  retryOnUnauthorized?: boolean
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(API_URL + path)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(key, String(value))
  }
  return url
}

async function send<T>(path: string, options: RequestOptions): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include', // send the refresh cookie to /auth/*
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.')
  }

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | ApiErrorBody | null
  if (!response.ok) {
    const error = payload && 'error' in payload ? payload.error : undefined
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `Request failed (${response.status})`,
      error?.details,
    )
  }
  return payload as ApiEnvelope<T>
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  try {
    return await send<T>(path, options)
  } catch (error) {
    const canRetry =
      options.retryOnUnauthorized !== false &&
      !path.startsWith('/auth/') &&
      error instanceof ApiError &&
      error.status === 401
    if (!canRetry) throw error
    const session = await refreshSession()
    if (!session) throw error
    return send<T>(path, { ...options, retryOnUnauthorized: false })
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, { query }).then((r) => r.data),
  page: <T>(path: string, query?: Query) => request<T[]>(path, { query }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }).then((r) => r.data),
  put: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'PUT', body, idempotencyKey }).then((r) => r.data),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }).then((r) => r.data),
}

// ---------------------------------------------------------------- Auth calls

let refreshInFlight: Promise<Session | null> | null = null

export function refreshSession(): Promise<Session | null> {
  refreshInFlight ??= send<Session>('/auth/refresh', { method: 'POST' })
    .then((envelope) => {
      setSession(envelope.data)
      return envelope.data
    })
    .catch(() => {
      setSession(null)
      return null
    })
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

export async function login(email: string, password: string): Promise<Session> {
  const { data } = await send<Session>('/auth/login', { method: 'POST', body: { email, password } })
  setSession(data)
  return data
}

export async function logout(): Promise<void> {
  try {
    await send('/auth/logout', { method: 'POST' })
  } finally {
    setSession(null)
  }
}
