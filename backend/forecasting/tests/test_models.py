"""Forecasting tests. Run from backend/forecasting:  python -m pytest"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import forecast  # noqa: E402
import models  # noqa: E402


def daily(values, start="2026-01-01"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="D"), dtype=float)


def test_wape_is_weighted_absolute_error():
    actual = np.array([10.0, 0.0, 10.0])
    predicted = np.array([8.0, 1.0, 12.0])
    assert models.wape(actual, predicted) == pytest.approx(5 / 20)


def test_wape_undefined_without_demand():
    assert models.wape(np.zeros(3), np.ones(3)) is None


def test_short_history_is_skipped():
    assert models.select_model(daily([1.0] * (models.MIN_HISTORY_DAYS - 1))) is None


def test_censored_days_do_not_count_as_history():
    values = [3.0] * 40
    series = daily(values)
    series.iloc[:15] = np.nan  # 25 observed days < 28
    assert models.select_model(series) is None


def test_sparse_detection_and_croston_candidate():
    sparse = daily([0, 0, 0, 0, 1] * 20)
    assert models.is_sparse(sparse)
    assert "croston_sba" in models.candidate_models(sparse)
    assert not models.is_sparse(daily([1, 2, 0, 3, 1] * 20))


def test_croston_forecasts_average_rate():
    # One unit of 4 every 4 days -> about 1 per day (times the SBA factor 0.95).
    series = daily([4, 0, 0, 0] * 30)
    assert models.croston_sba(series, 5)[0] == pytest.approx(0.95, rel=0.05)


def test_censored_replay_marks_out_of_stock_days():
    movements = pd.DataFrame(
        {
            "product_id": [1, 1, 1],
            "day": pd.to_datetime(["2026-01-01", "2026-01-02", "2026-01-04"]),
            "net": [5, -5, 3],
        }
    )
    censored = forecast.censored_days(movements, pd.Timestamp("2026-01-05"))
    assert censored[1] == {pd.Timestamp("2026-01-02"), pd.Timestamp("2026-01-03")}


def test_censored_days_are_nan_not_zero():
    sales = pd.DataFrame({"day": pd.to_datetime(["2026-01-01"]), "units": [2]})
    series = forecast.build_series(
        sales, {pd.Timestamp("2026-01-02")}, pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-03")
    )
    assert series.iloc[0] == 2 and np.isnan(series.iloc[1]) and series.iloc[2] == 0


def test_backtest_picks_the_lowest_wape():
    # A perfect weekly pattern: seasonal naive is exact, so it must win with WAPE 0.
    series = daily([12, 2, 2, 3, 3, 4, 10] * 20)
    result = models.select_model(series)
    assert result is not None
    assert result.model_name == "seasonal_naive_7"
    assert result.wape == pytest.approx(0, abs=1e-9)
    assert result.wape == min(score for score in result.scores.values() if score is not None)


def test_noisy_flat_demand_beats_the_baseline():
    rng = np.random.default_rng(42)
    series = daily(rng.poisson(6, 140))
    result = models.select_model(series)
    assert result is not None
    assert result.model_name != "seasonal_naive_7"
    assert result.wape < result.baseline_wape


def test_censored_days_are_ignored_when_scoring():
    values = [5.0] * 120
    series = daily(values)
    series.iloc[-10:-5] = np.nan  # stockout inside the last fold
    result = models.select_model(series)
    assert result is not None
    assert result.wape == pytest.approx(0, abs=1e-9)
    assert result.training_days == 115
