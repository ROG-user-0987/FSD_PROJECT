import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useState, type ReactNode } from 'react'
import { MovementChart, ValueBarChart } from '@/components/charts'
import { ALL, FilterBar, FilterSelect, toId } from '@/components/filters'
import { KpiCard } from '@/components/KpiCard'
import { PageHeader } from '@/components/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWarehouses } from '@/hooks/useLookups'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { DeadStock, MovementPoint, Turnover, Valuation, Velocity } from '@/types/api'
import { formatCurrency, formatCurrencyCompact, formatDate, formatNumber } from '@/utils/format'

const PERIODS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
]

function daysAgoIso(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - (days - 1))
  return date.toISOString().slice(0, 10)
}

function useReport<T>(report: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...queryKeys.analytics, report, params],
    queryFn: () => api.get<T>(`/analytics/${report}`, params),
  })
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function ProductTable({
  rows,
  columns,
}: {
  rows:
    | { key: number; product: { id: number; sku: string; name: string }; cells: ReactNode[] }[]
    | undefined
  columns: string[]
}) {
  if (!rows) return <Skeleton className="h-48 w-full" />
  if (rows.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          {columns.map((column) => (
            <TableHead key={column} className="text-right">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>
              <Link to={`/products/${row.product.id}`} className="hover:underline">
                <div className="font-medium">{row.product.name}</div>
                <div className="text-xs text-muted-foreground">{row.product.sku}</div>
              </Link>
            </TableCell>
            {row.cells.map((cell, i) => (
              <TableCell key={i} className="text-right tabular-nums">
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function AnalyticsPage() {
  const warehouses = useWarehouses()
  const [period, setPeriod] = useState('30')
  const [warehouseId, setWarehouseId] = useState(ALL)
  const [interval, setInterval] = useState<'day' | 'week'>('day')
  const [deadDays, setDeadDays] = useState('90')

  const base = { from: daysAgoIso(Number(period)), warehouseId: toId(warehouseId) }
  const valuation = useReport<Valuation>('valuation', { warehouseId: base.warehouseId, limit: 8 })
  const turnover = useReport<Turnover>('turnover', base)
  const movement = useReport<{ interval: string; series: MovementPoint[] }>('movement', {
    ...base,
    interval,
  })
  const fast = useReport<Velocity>('fast-moving', { ...base, limit: 8 })
  const slow = useReport<Velocity>('slow-moving', { ...base, limit: 8 })
  const dead = useReport<DeadStock>('dead-stock', {
    warehouseId: base.warehouseId,
    deadDays,
    limit: 8,
  })

  const v = valuation.data
  const t = turnover.data

  return (
    <>
      <PageHeader title="Analytics" description="Valuation, turnover and how stock moves." />
      <FilterBar>
        <FilterSelect label="Period" value={period} onChange={setPeriod} options={PERIODS} />
        <FilterSelect
          label="Warehouse"
          value={warehouseId}
          onChange={setWarehouseId}
          allLabel="All warehouses"
          options={(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
        />
      </FilterBar>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Inventory value"
          value={v ? formatCurrencyCompact(v.total) : '—'}
          hint={
            v
              ? `${formatNumber(v.units)} units · ${formatCurrency(v.inTransit.value)} in transit`
              : undefined
          }
          loading={!v}
        />
        <KpiCard
          label="Cost of goods sold"
          value={t ? formatCurrencyCompact(t.cogs) : '—'}
          hint={t ? `${formatDate(t.from)} – ${formatDate(t.to)}` : undefined}
          loading={!t}
        />
        <KpiCard
          label="Stock turnover"
          value={t?.turnover ?? '—'}
          hint={
            t?.annualisedTurnover ? `${t.annualisedTurnover}× per year at this pace` : undefined
          }
          loading={!t}
        />
        <KpiCard
          label="Days of inventory"
          value={t?.daysOfInventory ?? '—'}
          hint={t ? `average value ${formatCurrencyCompact(t.averageValue)}` : undefined}
          loading={!t}
        />
      </div>

      <div className="mb-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">Stock movement</CardTitle>
              <CardDescription>
                Units in vs units out
                {warehouseId === ALL ? ' (transfers between warehouses excluded)' : ''}.
              </CardDescription>
            </div>
            <Tabs value={interval} onValueChange={(value) => setInterval(value as 'day' | 'week')}>
              <TabsList>
                <TabsTrigger value="day">Daily</TabsTrigger>
                <TabsTrigger value="week">Weekly</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {movement.data ? (
              <MovementChart data={movement.data.series} height={280} />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Section title="Value by warehouse" description="Quantity × weighted-average cost.">
          {v ? (
            <ValueBarChart
              data={v.byWarehouse.map((row) => ({
                label: row.warehouse.name,
                value: Number(row.value),
              }))}
            />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </Section>
        <Section title="Value by category">
          {v ? (
            <ValueBarChart
              data={v.byCategory.map((row) => ({ label: row.category, value: Number(row.value) }))}
            />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </Section>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Section title="Fast-moving" description="Most units sold per day in the period.">
          <ProductTable
            columns={['Per day', 'Stock', 'Days of cover']}
            rows={fast.data?.items.map((row) => ({
              key: row.product.id,
              product: row.product,
              cells: [row.perDay, formatNumber(row.stock), row.daysOfCover ?? '—'],
            }))}
          />
        </Section>
        <Section
          title="Slow-moving"
          description={`Sold something, but fewer than ${slow.data?.thresholdPerDay ?? 0.2} units a day.`}
        >
          <ProductTable
            columns={['Sold', 'Per day', 'Stock']}
            rows={slow.data?.items.map((row) => ({
              key: row.product.id,
              product: row.product,
              cells: [row.unitsSold, row.perDay, formatNumber(row.stock)],
            }))}
          />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">Dead stock</CardTitle>
              <CardDescription>
                {dead.data
                  ? `${dead.data.count} products with stock but no movement out, worth ${formatCurrency(dead.data.totalValue)}.`
                  : 'Stock with no movement out.'}
              </CardDescription>
            </div>
            <FilterSelect
              label="Idle for"
              value={deadDays}
              onChange={setDeadDays}
              className="w-32"
              options={[
                { value: '60', label: '60+ days' },
                { value: '90', label: '90+ days' },
                { value: '180', label: '180+ days' },
              ]}
            />
          </CardHeader>
          <CardContent>
            <ProductTable
              columns={['Units', 'Value', 'Last out']}
              rows={dead.data?.items.map((row) => ({
                key: row.product.id,
                product: row.product,
                cells: [
                  formatNumber(row.units),
                  formatCurrency(row.value),
                  row.daysSinceOutgoing === null ? 'never' : `${row.daysSinceOutgoing} days ago`,
                ],
              }))}
            />
          </CardContent>
        </Card>
        <Section title="Most valuable stock">
          <ProductTable
            columns={['Units', 'Value']}
            rows={v?.topProducts.map((row) => ({
              key: row.product.id,
              product: row.product,
              cells: [formatNumber(row.units), formatCurrency(row.value)],
            }))}
          />
        </Section>
      </div>
    </>
  )
}
