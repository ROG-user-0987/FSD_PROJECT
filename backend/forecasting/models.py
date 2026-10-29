"""Forecasting models and model selection.

A product's history is a daily pandas Series of units sold. Censored days (the product
was out of stock, so real demand was not observed) are NaN: they are never used to
score a model, and are filled with a sensible guess only where a model needs an
unbroken series to fit.

Candidates:
  - seasonal_naive_7   tomorrow = same weekday last week. Always computed: the BASELINE.
  - moving_average_28  mean of the last 28 observed days
  - ets                Holt-Winters exponential smoothing with weekly seasonality
                       (statsmodels), when there are at least 8 weeks of data
  - ses                simple exponential smoothing, for shorter histories
  - croston_sba        Croston with the Syntetos-Boylan correction, only for sparse
                       series (more than 60% zero days)

Selection: rolling-origin backtest over the last 4 folds of 14 days. For each fold the
model is fitted on everything before the fold and forecasts the 14 days. Errors are
pooled over all folds into one WAPE (sum |error| / sum actual). Lowest WAPE wins; on a
tie the simpler model (earlier in the list) wins.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd

MIN_HISTORY_DAYS = 28  # observed (non-censored) days needed for any forecast
BACKTEST_FOLDS = 4
FOLD_DAYS = 14
HORIZON_DAYS = 30
SPARSE_ZERO_SHARE = 0.60
ETS_MIN_DAYS = 56  # 8 weeks: enough to estimate a weekly pattern
CROSTON_ALPHA = 0.1

BASELINE = "seasonal_naive_7"


@dataclass(frozen=True)
class ModelResult:
    model_name: str
    forecast: np.ndarray  # HORIZON_DAYS predicted units per day
    wape: float | None
    baseline_wape: float | None
    training_days: int
    scores: dict[str, float | None]


def wape(actual: np.ndarray, predicted: np.ndarray) -> float | None:
    """Weighted absolute percentage error: sum|actual - predicted| / sum(actual).

    None when there was no actual demand (the ratio is undefined)."""
    total = float(np.sum(actual))
    if total == 0:
        return None
    return float(np.sum(np.abs(actual - predicted)) / total)


def is_sparse(series: pd.Series) -> bool:
    observed = series.dropna()
    return len(observed) > 0 and bool((observed == 0).mean() > SPARSE_ZERO_SHARE)


def fill_censored(series: pd.Series) -> np.ndarray:
    """Values with NaN (censored) days replaced: same weekday last week if known,
    otherwise the mean of the previous 28 observed days, otherwise 0."""
    values = series.to_numpy(dtype=float).copy()
    for i, value in enumerate(values):
        if not np.isnan(value):
            continue
        if i >= 7 and not np.isnan(values[i - 7]):
            values[i] = values[i - 7]
            continue
        window = values[max(0, i - 28) : i]
        window = window[~np.isnan(window)]
        values[i] = float(window.mean()) if len(window) else 0.0
    return values


# ---------------------------------------------------------------- Models


def seasonal_naive(train: pd.Series, horizon: int) -> np.ndarray:
    values = fill_censored(train)
    if len(values) < 7:
        return np.full(horizon, float(values.mean()) if len(values) else 0.0)
    last_week = values[-7:]
    return np.array([last_week[i % 7] for i in range(horizon)])


def moving_average(train: pd.Series, horizon: int) -> np.ndarray:
    observed = train.dropna().to_numpy(dtype=float)[-28:]
    return np.full(horizon, float(observed.mean()) if len(observed) else 0.0)


def exponential_smoothing(train: pd.Series, horizon: int) -> np.ndarray:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing, SimpleExpSmoothing

    values = fill_censored(train)
    if len(values) < 2 or not values.any():
        return np.zeros(horizon)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # convergence chatter on flat or noisy series
        if len(values) >= ETS_MIN_DAYS:
            fitted = ExponentialSmoothing(
                values,
                trend=None,
                seasonal="add",
                seasonal_periods=7,
                initialization_method="estimated",
            ).fit()
        else:
            fitted = SimpleExpSmoothing(values, initialization_method="estimated").fit()
        return np.clip(np.asarray(fitted.forecast(horizon), dtype=float), 0, None)


def croston_sba(train: pd.Series, horizon: int, alpha: float = CROSTON_ALPHA) -> np.ndarray:
    """Croston: smooth the size of non-zero demands (z) and the gap between them (p)
    separately; forecast z / p per day. SBA multiplies by (1 - alpha/2) to remove
    Croston's known upward bias."""
    observed = train.dropna().to_numpy(dtype=float)
    size = interval = None
    gap = 1
    for value in observed:
        if value > 0:
            if size is None:
                size, interval = value, float(gap)
            else:
                size += alpha * (value - size)
                interval += alpha * (gap - interval)
            gap = 1
        else:
            gap += 1
    if size is None or not interval:
        return np.zeros(horizon)
    return np.full(horizon, (1 - alpha / 2) * size / interval)


MODELS = {
    "seasonal_naive_7": seasonal_naive,
    "moving_average_28": moving_average,
    "ets": exponential_smoothing,
    "ses": exponential_smoothing,
    "croston_sba": croston_sba,
}


def candidate_models(series: pd.Series) -> list[str]:
    names = [BASELINE, "moving_average_28", "ets" if len(series) >= ETS_MIN_DAYS else "ses"]
    if is_sparse(series):
        names.append("croston_sba")
    return names


def fit_and_forecast(model_name: str, train: pd.Series, horizon: int) -> np.ndarray:
    return np.clip(MODELS[model_name](train, horizon), 0, None)


def backtest(model_name: str, series: pd.Series) -> float | None:
    """Pooled WAPE over the last BACKTEST_FOLDS folds of FOLD_DAYS days.

    Censored (NaN) days in a test window are skipped. Folds whose training part would be
    shorter than MIN_HISTORY_DAYS are skipped."""
    errors = actual_total = 0.0
    n = len(series)
    for k in range(BACKTEST_FOLDS, 0, -1):
        split = n - k * FOLD_DAYS
        if split < MIN_HISTORY_DAYS:
            continue
        train, test = series.iloc[:split], series.iloc[split : split + FOLD_DAYS]
        predicted = fit_and_forecast(model_name, train, len(test))
        actual = test.to_numpy(dtype=float)
        mask = ~np.isnan(actual)
        errors += float(np.abs(actual[mask] - predicted[mask]).sum())
        actual_total += float(actual[mask].sum())
    return None if actual_total == 0 else errors / actual_total


def select_model(series: pd.Series) -> ModelResult | None:
    """Best model for one product's daily demand (censored days = NaN).

    None when there are fewer than MIN_HISTORY_DAYS observed days: the product gets no
    forecast and the UI shows "not enough history"."""
    training_days = int(series.notna().sum())
    if training_days < MIN_HISTORY_DAYS:
        return None

    names = candidate_models(series)
    scores = {name: backtest(name, series) for name in names}
    scored = [name for name in names if scores[name] is not None]
    # min() keeps the first of equal scores, so simpler models win ties.
    best = min(scored, key=lambda name: scores[name]) if scored else "moving_average_28"

    return ModelResult(
        model_name=best,
        forecast=np.round(fit_and_forecast(best, series, HORIZON_DAYS), 2),
        wape=scores.get(best),
        baseline_wape=scores[BASELINE],
        training_days=training_days,
        scores=scores,
    )
