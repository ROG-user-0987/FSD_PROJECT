// Status badges with one consistent colour language:
// green = fine, amber = attention, red = problem, indigo = in progress, grey = neutral.
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { StockStatus, TransactionType, TransferStatus, Urgency } from '@/types/api'

const tone = {
  green:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  amber:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  indigo:
    'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300',
  grey: 'border-border bg-muted text-muted-foreground',
}

function Pill({ color, children }: { color: keyof typeof tone; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={cn('font-medium whitespace-nowrap', tone[color])}>
      {children}
    </Badge>
  )
}

export const STOCK_LABELS: Record<StockStatus, string> = {
  in: 'In stock',
  low: 'Low stock',
  out: 'Out of stock',
}

export function StockBadge({ status }: { status: StockStatus }) {
  const color = status === 'in' ? 'green' : status === 'low' ? 'amber' : 'red'
  return <Pill color={color}>{STOCK_LABELS[status]}</Pill>
}

export const TRANSFER_LABELS: Record<TransferStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  IN_TRANSIT: 'In transit',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
}

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const color = (
    {
      REQUESTED: 'amber',
      APPROVED: 'indigo',
      IN_TRANSIT: 'indigo',
      RECEIVED: 'green',
      CANCELLED: 'grey',
    } as const
  )[status]
  return <Pill color={color}>{TRANSFER_LABELS[status]}</Pill>
}

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  STOCK_IN: 'Stock in',
  PURCHASE: 'Purchase',
  STOCK_OUT: 'Stock out',
  SALE: 'Sale',
  RETURN: 'Return',
  ADJUSTMENT: 'Adjustment',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
}

export function TransactionTypeBadge({ type }: { type: TransactionType }) {
  const color = (
    {
      STOCK_IN: 'green',
      PURCHASE: 'green',
      RETURN: 'green',
      SALE: 'indigo',
      STOCK_OUT: 'amber',
      ADJUSTMENT: 'grey',
      TRANSFER_OUT: 'grey',
      TRANSFER_IN: 'grey',
    } as const
  )[type]
  return <Pill color={color}>{TRANSACTION_LABELS[type]}</Pill>
}

export const URGENCY_LABELS: Record<Urgency, string> = {
  ORDER_NOW: 'Order now',
  SOON: 'Order soon',
  OK: 'OK',
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const color = urgency === 'ORDER_NOW' ? 'red' : urgency === 'SOON' ? 'amber' : 'green'
  return <Pill color={color}>{URGENCY_LABELS[urgency]}</Pill>
}

// "+12" in green, "-3" in red.
export function QuantityChange({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      {value > 0 ? `+${value}` : value}
    </span>
  )
}
