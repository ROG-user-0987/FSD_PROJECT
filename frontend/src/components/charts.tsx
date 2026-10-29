// Recharts wrappers in the app's theme (colours come from the CSS variables, so the
// charts follow light and dark mode).
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency, formatCurrencyCompact, formatNumber } from '@/utils/format'
import type { MovementPoint } from '@/types/api'

const axis = { fontSize: 12, stroke: 'var(--muted-foreground)', tickLine: false, axisLine: false }
const tooltipStyle = {
  contentStyle: {
    background: 'var(--popover)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--popover-foreground)',
  },
  labelStyle: { color: 'var(--muted-foreground)' },
}

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

export function MovementChart({ data, height = 260 }: { data: MovementPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="in" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="out" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axis} />
        <YAxis width={44} tickFormatter={(v: number) => formatNumber(v)} {...axis} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(label) => shortDate(String(label))}
          formatter={(value, name) => [
            formatNumber(Number(value)),
            name === 'incoming' ? 'Units in' : 'Units out',
          ]}
        />
        <Legend
          formatter={(name) => (name === 'incoming' ? 'Units in' : 'Units out')}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="incoming"
          stroke="var(--chart-2)"
          fill="url(#in)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="outgoing"
          stroke="var(--primary)"
          fill="url(#out)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// Horizontal bars of money values (value by warehouse, by category).
export function ValueBarChart({
  data,
  height = 260,
}: {
  data: { label: string; value: number }[]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tickFormatter={(v: number) => formatCurrencyCompact(v)} {...axis} />
        <YAxis type="category" dataKey="label" width={120} {...axis} />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: 'var(--muted)' }}
          formatter={(value) => [formatCurrency(Number(value)), 'Value']}
        />
        <Bar dataKey="value" fill="var(--primary)" radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Actual daily sales (bars) followed by the forecast (line).
export function ForecastChart({
  history,
  forecast,
  height = 280,
}: {
  history: { date: string; actual: number; censored: boolean }[]
  forecast: { date: string; qty: number }[]
  height?: number
}) {
  const data = [
    ...history.map((point) => ({
      date: point.date,
      actual: point.censored ? null : point.actual,
      stockout: point.censored ? point.actual : null,
    })),
    ...forecast.map((point) => ({ date: point.date, forecast: point.qty })),
  ]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} {...axis} />
        <YAxis width={36} {...axis} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(label) => shortDate(String(label))}
          formatter={(value, name) => {
            const labels: Record<string, string> = {
              actual: 'Sold',
              stockout: 'Sold (out of stock that day)',
              forecast: 'Forecast',
            }
            return [
              Number(value).toFixed(name === 'forecast' ? 1 : 0),
              labels[String(name)] ?? name,
            ]
          }}
        />
        <Legend
          formatter={(name) =>
            ({ actual: 'Units sold', stockout: 'Out-of-stock day', forecast: 'Forecast' })[
              String(name)
            ] ?? name
          }
          wrapperStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="actual" fill="var(--chart-2)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="stockout" fill="var(--destructive)" radius={[2, 2, 0, 0]} />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
