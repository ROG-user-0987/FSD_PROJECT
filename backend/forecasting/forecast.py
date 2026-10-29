"""Nightly demand-forecast job.

    cd backend/forecasting
    python -m venv .venv && .venv\\Scripts\\activate     (Windows)
    pip install -r requirements.txt
    python forecast.py

Steps:
  1. Daily SALE units per product (all warehouses combined).
  2. Replay the ledger to find days when the product's total stock was 0 at the end of
     the day. Those days are censored (NaN), NOT zero demand.
  3. models.select_model() per product: backtest by WAPE, seasonal naive = baseline.
  4. Write 30 days of predictions (starting today) to the Forecast table.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd

import db
import models


def censored_days(movements: pd.DataFrame, until: pd.Timestamp) -> dict[int, set[pd.Timestamp]]:
    """Days on which each product's total stock ended at 0 (or below), per product.

    `movements` has product_id, day, net (net stock change that day)."""
    result: dict[int, set[pd.Timestamp]] = {}
    for product_id, group in movements.groupby("product_id"):
        daily = group.set_index("day")["net"].sort_index()
        index = pd.date_range(daily.index.min(), until, freq="D")
        end_of_day = daily.reindex(index, fill_value=0).cumsum()
        result[int(product_id)] = set(end_of_day[end_of_day <= 0].index)
    return result


def build_series(
    sales: pd.DataFrame,
    censored: set[pd.Timestamp],
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> pd.Series:
    """Daily units for one product from `start` to `end`, zero-filled, censored days NaN.

    `sales` holds only this product's rows (day, units)."""
    index = pd.date_range(start, end, freq="D")
    series = sales.set_index("day")["units"].reindex(index, fill_value=0).astype(float)
    if censored:
        series[series.index.isin(list(censored))] = float("nan")
    return series


def run() -> None:
    now = datetime.now(timezone.utc)
    today = pd.Timestamp(now.date())
    yesterday = today - pd.Timedelta(days=1)

    connection = db.connect()
    try:
        sales = db.load_sales(connection)
        movements = db.load_stock_movements(connection)
        censored = censored_days(movements, yesterday)
        first_day = movements.groupby("product_id")["day"].min()
        skus = dict(connection.execute('SELECT "id", "sku" FROM "Product"').fetchall())

        written = skipped = 0
        report: list[tuple[str, str, float | None, float | None, float]] = []
        for product_id in db.load_products(connection):
            if product_id not in first_day.index:
                skipped += 1
                continue
            series = build_series(
                sales[sales["product_id"] == product_id],
                censored.get(product_id, set()),
                first_day[product_id],
                yesterday,
            )
            result = models.select_model(series)
            if result is None:
                skipped += 1
                continue

            predicted_daily = [
                {"date": (now.date() + timedelta(days=i)).isoformat(), "qty": float(qty)}
                for i, qty in enumerate(result.forecast)
            ]
            db.write_forecast(
                connection,
                product_id=product_id,
                model_name=result.model_name,
                predicted_daily=predicted_daily,
                wape=None if result.wape is None else round(result.wape, 4),
                baseline_wape=None if result.baseline_wape is None else round(result.baseline_wape, 4),
                training_days=result.training_days,
                horizon_days=models.HORIZON_DAYS,
                generated_at=now,
            )
            written += 1
            report.append((skus.get(product_id, str(product_id)), result.model_name, result.wape, result.baseline_wape, float(series.sum())))
        connection.commit()
    finally:
        connection.close()

    print(f"Forecasts written: {written}, skipped (not enough history): {skipped}")
    print_accuracy(report)


def print_accuracy(report: list[tuple[str, str, float | None, float | None, float]]) -> None:
    scored = [row for row in report if row[2] is not None and row[3] is not None]
    if not scored:
        return
    beats = sum(1 for row in scored if row[2] < row[3])  # type: ignore[operator]
    mean_model = sum(row[2] for row in scored) / len(scored)  # type: ignore[misc]
    mean_base = sum(row[3] for row in scored) / len(scored)  # type: ignore[misc]
    print(f"Chosen model beats the seasonal-naive baseline on {beats}/{len(scored)} products")
    print(f"Mean WAPE: chosen {mean_model:.1%} vs baseline {mean_base:.1%}")
    models_used = pd.Series([row[1] for row in report]).value_counts().to_dict()
    print(f"Models chosen: {models_used}")
    print("\nSample (12 best-selling products):")
    print(f"{'SKU':<10} {'model':<18} {'WAPE':>7} {'baseline':>9}")
    for sku, name, model_wape, base_wape, _ in sorted(report, key=lambda row: -row[4])[:12]:
        fmt = lambda v: "   n/a" if v is None else f"{v:6.1%}"  # noqa: E731
        print(f"{sku:<10} {name:<18} {fmt(model_wape):>7} {fmt(base_wape):>9}")


if __name__ == "__main__":
    run()
