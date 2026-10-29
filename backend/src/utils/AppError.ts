// The one error type services throw. The error handler turns it into
// { error: { code, message, details? } } with the given HTTP status.
export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, status: number, message?: string, details?: unknown) {
    super(message ?? code)
    this.code = code
    this.status = status
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('BAD_REQUEST', 400, message, details)
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Authentication required') =>
  new AppError(code, 401, message)
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError('FORBIDDEN', 403, message)
export const notFound = (entity: string) => new AppError('NOT_FOUND', 404, `${entity} not found`)
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(code, 409, message, details)

// Placeholder for skeleton endpoints that are wired up but not built yet (HTTP 501).
export function notImplemented(feature: string): never {
  throw new AppError('NOT_IMPLEMENTED', 501, `${feature} is not implemented yet`)
}
