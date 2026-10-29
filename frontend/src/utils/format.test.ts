import { describe, expect, it } from 'vitest'
import { formatCurrency, formatNumber, formatRelative, formatSigned, initials } from './format'

describe('formatCurrency', () => {
  it('formats rupees with Indian digit grouping and 2 decimals', () => {
    expect(formatCurrency('1249.5')).toBe('₹1,249.50')
    expect(formatCurrency('1234567')).toBe('₹12,34,567.00')
    expect(formatCurrency(0)).toBe('₹0.00')
  })

  it('shows a dash for missing or invalid values', () => {
    expect(formatCurrency(null)).toBe('—')
    expect(formatCurrency(undefined)).toBe('—')
    expect(formatCurrency('')).toBe('—')
    expect(formatCurrency('abc')).toBe('—')
  })
})

describe('numbers', () => {
  it('groups digits the Indian way', () => {
    expect(formatNumber(1234567)).toBe('12,34,567')
  })

  it('signs ledger changes', () => {
    expect(formatSigned(12)).toBe('+12')
    expect(formatSigned(-3)).toBe('-3')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-10-28T12:00:00Z')
  it('says "just now" for the last minute', () => {
    expect(formatRelative('2026-10-28T11:59:30Z', now)).toBe('just now')
  })
})

describe('initials', () => {
  it('takes the first letters of up to two words', () => {
    expect(initials('Priya Sharma')).toBe('PS')
    expect(initials('admin')).toBe('A')
    expect(initials('  ')).toBe('?')
  })
})
