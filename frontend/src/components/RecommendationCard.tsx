// Reorder recommendation with every input of the formula, plus forecast accuracy.
import { UrgencyBadge } from '@/components/badges'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ForecastAccuracy, Recommendation } from '@/types/api'
import { formatDateTime, formatNumber } from '@/utils/format'

export const MODEL_LABELS: Record<string, string> = {
  seasonal_naive_7: 'Seasonal naive (7 days)',
  moving_average_28: '28-day moving average',
  ets: 'Exponential smoothing (weekly)',
  ses: 'Simple exponential smoothing',
  croston_sba: 'Croston (SBA) for sparse demand',
}

export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  )
}

export function RecommendationCard({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Reorder recommendation</CardTitle>
          <CardDescription>95% service level, 7-day review period.</CardDescription>
        </div>
        <UrgencyBadge urgency={r.urgency} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {formatNumber(r.recommendedQty)}
          </span>
          <span className="text-sm text-muted-foreground">units to order</span>
        </div>
        <p className="text-sm leading-relaxed">{r.explanation}</p>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Stat label="Avg daily demand" value={r.avgDaily} />
          <Stat label="Safety stock" value={r.safetyStock} />
          <Stat label="Reorder point" value={r.reorderPoint} />
          <Stat label="Target cover" value={r.targetCover} />
          <Stat label="Available" value={`${r.onHand} + ${r.inTransit} in transit`} />
          <Stat
            label="Stockout in"
            value={r.stockoutInDays === null ? 'not expected' : `${r.stockoutInDays} days`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Stock on order is always 0: InventoryOS v1 has no purchase orders.
        </p>
      </CardContent>
    </Card>
  )
}

export function AccuracyCard({ accuracy }: { accuracy: ForecastAccuracy | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Forecast accuracy</CardTitle>
        <CardDescription>
          Backtest over the last 8 weeks. WAPE = total error ÷ total demand (lower is better).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!accuracy ? (
          <p className="text-muted-foreground">
            Not enough history for a forecast yet (28 days needed).
          </p>
        ) : (
          <>
            <div className="font-medium">
              {MODEL_LABELS[accuracy.modelName] ?? accuracy.modelName}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Model WAPE" value={percent(accuracy.wape)} />
              <Stat label="Baseline WAPE" value={percent(accuracy.baselineWape)} />
            </div>
            <p className="text-muted-foreground">
              {accuracy.improvement === null
                ? 'No demand in the backtest window, so accuracy cannot be scored.'
                : accuracy.improvement > 0
                  ? `${percent(accuracy.improvement)} more accurate than the seasonal-naive baseline.`
                  : 'The seasonal-naive baseline is as good as any model here, so it is used.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Trained on {accuracy.trainingDays} days · generated{' '}
              {formatDateTime(accuracy.generatedAt)}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
