// Validates body, query and params with Zod and replaces them with the parsed
// (typed, coerced, defaulted) values. Invalid input -> 400 VALIDATION_ERROR.
import type { NextFunction, Request, Response } from 'express'
import type { ZodType } from 'zod'
import { AppError } from '../utils/AppError.js'

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType }

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: { path: string; message: string }[] = []

    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part]
      if (!schema) continue
      const result = schema.safeParse(req[part] ?? {})
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ path: [part, ...issue.path].join('.'), message: issue.message })
        }
        continue
      }
      // Express 5 makes req.query a getter, so it is redefined instead of assigned.
      Object.defineProperty(req, part, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      })
    }

    if (issues.length > 0) {
      throw new AppError('VALIDATION_ERROR', 400, 'Invalid request', issues)
    }
    next()
  }
}
