import type { Request } from 'express'

// After validate({ params: idParam }) the id is already a number; Express's types
// still say string, so it is converted once here.
export const idParam = (req: Request, name = 'id') => Number(req.params[name])

// After validate(), req.query holds the parsed Zod output.
export const parsedQuery = <T>(req: Request) => req.query as unknown as T
