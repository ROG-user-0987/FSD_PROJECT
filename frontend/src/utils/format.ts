// Display formatting only. Money arrives from the API as strings; it is converted to
// a number solely to format it. The client never does money arithmetic.
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'
import type { Money } from '@/types/api'

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
const integer = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const compactInr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatCurrency(value: Money | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? inr.format(amount) : '—'
}

// "₹12.3L"-style short form for KPI cards and chart axes.
export function formatCurrencyCompact(value: Money | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? compactInr.format(amount) : '—'
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : integer.format(value)
}

// +12 / -3, for ledger quantity changes.
export function formatSigned(value: number): string {
  return value > 0 ? `+${integer.format(value)}` : integer.format(value)
}

export function formatDate(iso: string): string {
  return format(parseISO(iso), 'dd MMM yyyy')
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), 'dd MMM yyyy, HH:mm')
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = parseISO(iso)
  if (now.getTime() - date.getTime() < 60_000) return 'just now'
  return `${formatDistanceToNowStrict(date)} ago`
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}
