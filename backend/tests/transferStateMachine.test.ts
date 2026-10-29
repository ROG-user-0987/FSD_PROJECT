import { describe, expect, it } from 'vitest'
import type { TransferStatus } from '../src/generated/prisma/client.js'
import { assertTransition, type TransferAction } from '../src/services/transfer.service.js'
import { AppError } from '../src/utils/AppError.js'

const VALID: [TransferStatus, TransferAction, TransferStatus][] = [
  ['REQUESTED', 'approve', 'APPROVED'],
  ['APPROVED', 'dispatch', 'IN_TRANSIT'],
  ['IN_TRANSIT', 'receive', 'RECEIVED'],
  ['REQUESTED', 'cancel', 'CANCELLED'],
  ['APPROVED', 'cancel', 'CANCELLED'],
]

const INVALID: [TransferStatus, TransferAction][] = [
  ['REQUESTED', 'dispatch'], // must be approved first
  ['REQUESTED', 'receive'],
  ['APPROVED', 'approve'],
  ['IN_TRANSIT', 'cancel'], // stock already left: cancelling is not allowed
  ['IN_TRANSIT', 'dispatch'],
  ['RECEIVED', 'cancel'],
  ['RECEIVED', 'receive'],
  ['CANCELLED', 'approve'],
]

describe('transfer state machine', () => {
  it.each(VALID)('%s --%s--> %s', (from, action, to) => {
    expect(assertTransition(from, action)).toBe(to)
  })

  it.each(INVALID)('%s cannot %s (409)', (from, action) => {
    try {
      assertTransition(from, action)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).status).toBe(409)
      expect((error as AppError).code).toBe('INVALID_TRANSITION')
    }
  })
})
