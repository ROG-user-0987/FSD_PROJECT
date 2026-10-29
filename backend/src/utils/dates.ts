// Day-level date helpers. Timestamps are stored as ISO 8601 UTC text, so the first
// 10 characters are the UTC day ("2026-10-28"), which raw SQL compares as text.
const DAY_MS = 24 * 60 * 60 * 1000

export const isoDay = (date: Date) => date.toISOString().slice(0, 10)

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export const daysAgo = (days: number, from = new Date()) =>
  startOfUtcDay(new Date(from.getTime() - days * DAY_MS))

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS)

// Every day from `from` to `to` (inclusive), as "YYYY-MM-DD".
export function dayList(from: Date, to: Date): string[] {
  const days: string[] = []
  for (let day = startOfUtcDay(from); day <= to; day = addDays(day, 1)) days.push(isoDay(day))
  return days
}

export const daysBetween = (from: Date, to: Date) =>
  Math.max(
    1,
    Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS) + 1,
  )
