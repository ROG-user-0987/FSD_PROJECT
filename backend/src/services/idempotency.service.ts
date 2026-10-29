// Correctness rule 3: Idempotency-Key handling for stock and transfer actions.
//
// Everything happens inside ONE database transaction:
//   1. key seen before?  same endpoint + same body -> return the stored response (no change)
//                        different endpoint/body   -> 422 IDEMPOTENCY_KEY_REUSED
//   2. otherwise do the work and store the response under the key, in the same transaction.
// SQLite runs one write transaction at a time, so two identical requests in parallel are
// handled one after the other: the second one finds the first one's record. The unique
// (userId, key) index is a second line of defence.
//
// Socket events collected by the work run only after commit, and never for a replay.
import { prisma, type Tx } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { hashPayload } from '../utils/crypto.js'
import { toJsonValue } from '../utils/json.js'
import { PostCommit } from '../utils/postCommit.js'

type Options = {
  key?: string
  userId: number
  endpoint: string // e.g. "POST /inventory/stock-out"
  payload: unknown // the validated request body (and ids from the URL)
  statusCode?: number
}

export async function withIdempotency<T>(
  options: Options,
  work: (tx: Tx, after: PostCommit) => Promise<T>,
): Promise<T> {
  const after = new PostCommit()
  const requestHash = hashPayload(options.payload)

  const result = await prisma.$transaction(async (tx) => {
    if (options.key) {
      const existing = await tx.idempotencyRecord.findUnique({
        where: { userId_key: { userId: options.userId, key: options.key } },
      })
      if (existing) {
        if (existing.endpoint !== options.endpoint || existing.requestHash !== requestHash) {
          throw new AppError(
            'IDEMPOTENCY_KEY_REUSED',
            422,
            'This Idempotency-Key was already used for a different request',
          )
        }
        // The stored JSON has the same shape the client got the first time.
        return { replayed: true, body: existing.response as T }
      }
    }

    const body = await work(tx, after)
    if (options.key) {
      await tx.idempotencyRecord.create({
        data: {
          key: options.key,
          userId: options.userId,
          endpoint: options.endpoint,
          requestHash,
          statusCode: options.statusCode ?? 200,
          response: toJsonValue(body),
        },
      })
    }
    return { replayed: false, body }
  })

  if (!result.replayed) after.flush()
  return result.body
}
