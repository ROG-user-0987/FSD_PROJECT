"""Database access for the forecast job (SQLite, Python standard library).

Reads the same file as the API (DATABASE_URL in backend/.env, e.g. file:./prisma/dev.db).
Timestamps are ISO 8601 UTC text, so the first 10 characters are the UTC day.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent


def database_path() -> Path:
    """Resolve DATABASE_URL ("file:./prisma/dev.db") against backend/, like the API does."""
    load_dotenv(BACKEND_DIR / ".env")
    url = os.environ.get("DATABASE_URL", "file:./prisma/dev.db")
    path = Path(url.removeprefix("file:"))
    return path if path.is_absolute() else (BACKEND_DIR / path).resolve()


def connect(path: Path | None = None) -> sqlite3.Connection:
    connection = sqlite3.connect(path or database_path())
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def load_products(connection: sqlite3.Connection) -> list[int]:
    rows = connection.execute('SELECT "id" FROM "Product" WHERE "isActive" = 1 ORDER BY "id"')
    return [int(row[0]) for row in rows]


def load_sales(connection: sqlite3.Connection) -> pd.DataFrame:
    """Units sold per product per day (SALE rows, all warehouses combined).

    Columns: product_id, day (Timestamp), units (int).
    """
    frame = pd.read_sql_query(
        """SELECT "productId" AS product_id, substr("createdAt", 1, 10) AS day,
                  SUM(-"quantityChange") AS units
           FROM "InventoryTransaction" WHERE "type" = 'SALE'
           GROUP BY product_id, day""",
        connection,
    )
    frame["day"] = pd.to_datetime(frame["day"])
    return frame


def load_stock_movements(connection: sqlite3.Connection) -> pd.DataFrame:
    """Net stock change per product per day (every ledger row, all warehouses).

    Used to replay the total stock per product per day and find out-of-stock days.
    Columns: product_id, day (Timestamp), net (int).
    """
    frame = pd.read_sql_query(
        """SELECT "productId" AS product_id, substr("createdAt", 1, 10) AS day,
                  SUM("quantityChange") AS net
           FROM "InventoryTransaction"
           GROUP BY product_id, day""",
        connection,
    )
    frame["day"] = pd.to_datetime(frame["day"])
    return frame


def write_forecast(
    connection: sqlite3.Connection,
    *,
    product_id: int,
    model_name: str,
    predicted_daily: list[dict[str, float | str]],
    wape: float | None,
    baseline_wape: float | None,
    training_days: int,
    horizon_days: int,
    generated_at: datetime | None = None,
) -> None:
    """Insert one Forecast row, with timestamps in the same ISO format Prisma writes."""
    moment = (generated_at or datetime.now(timezone.utc)).isoformat(timespec="milliseconds")
    connection.execute(
        """INSERT INTO "Forecast" ("productId", "generatedAt", "horizonDays", "modelName",
               "predictedDaily", "predictedTotal", "wape", "baselineWape", "trainingDays")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            product_id,
            moment,
            horizon_days,
            model_name,
            json.dumps(predicted_daily),
            round(float(sum(float(day["qty"]) for day in predicted_daily)), 2),
            wape,
            baseline_wape,
            training_days,
        ),
    )
