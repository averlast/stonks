#!/usr/bin/env python
"""Ingest one day's 1-second OHLCV bars to local Parquet (GitHub issue #1).

Pulls the first two hours of RTH (09:30-11:30 America/New_York) 1-second OHLCV
bars for one symbol/day from Databento GLBX.MDP3, converts UTC to exchange-local
time (DST-correct), and writes a gitignored Parquet file queryable via DuckDB.

Design record: SPEC.md decisions 1/2/12/13, ADR-0001 (isolated Python ingestion).
Bars are a disposable local cache and are never committed; only the manifest is
tracked. Ticks for ambiguous-bar resolution are a separate concern (issue #4).

Usage:
    python ingestion/fetch_day.py                      # NQ 2024-08-05 (whipsaw day)
    python ingestion/fetch_day.py --symbol ES --date 2024-08-05
    python ingestion/fetch_day.py --quote-only         # cost quote, no pull
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import databento as db
import duckdb
from dotenv import load_dotenv

# --- Fixed design constants (SPEC decisions 1, 2; ADR-0001) --------------------
DATASET = "GLBX.MDP3"          # CME Globex MDP 3.0
SCHEMA = "ohlcv-1s"            # 1-second OHLCV is the floor (SPEC 2.1)
EXCHANGE_TZ = ZoneInfo("America/New_York")
SESSION_OPEN = time(9, 30)     # RTH open, ET
SESSION_END = time(11, 30)     # first 2h of the open (SPEC 2, tier 1)

REPO_ROOT = Path(__file__).resolve().parent.parent
BARS_DIR = REPO_ROOT / "data" / "bars"        # gitignored cache
MANIFEST_PATH = REPO_ROOT / "data" / "manifest.json"  # tracked source of truth


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--symbol", default="NQ",
                   help="Root symbol, e.g. NQ or ES (minis are source of truth).")
    p.add_argument("--date", default="2024-08-05",
                   help="Practice day, YYYY-MM-DD (default: whipsaw test day).")
    p.add_argument("--quote-only", action="store_true",
                   help="Print the cost quote and exit without pulling data.")
    p.add_argument("--max-cost", type=float, default=5.0,
                   help="Abort if the quoted cost exceeds this USD amount.")
    p.add_argument("--force", action="store_true",
                   help="Re-pull even if the Parquet already exists.")
    return p.parse_args()


def session_window_utc(day: datetime.date) -> tuple[datetime, datetime]:
    """Return the [09:30, 11:30) ET window as tz-aware UTC datetimes (DST-correct)."""
    start_et = datetime.combine(day, SESSION_OPEN, tzinfo=EXCHANGE_TZ)
    end_et = datetime.combine(day, SESSION_END, tzinfo=EXCHANGE_TZ)
    return start_et.astimezone(ZoneInfo("UTC")), end_et.astimezone(ZoneInfo("UTC"))


def main() -> int:
    args = parse_args()
    load_dotenv(REPO_ROOT / ".env")  # DATABENTO_API_KEY never leaves the machine

    try:
        day = datetime.strptime(args.date, "%Y-%m-%d").date()
    except ValueError:
        print(f"error: --date must be YYYY-MM-DD, got {args.date!r}", file=sys.stderr)
        return 2

    # Continuous front-month symbology: roll-robust and self-documenting.
    # "NQ.c.0" = front-month calendar-continuous contract on the given day.
    cont_symbol = f"{args.symbol}.c.0"
    start_utc, end_utc = session_window_utc(day)

    client = db.Historical()  # reads DATABENTO_API_KEY from the environment

    request = dict(
        dataset=DATASET,
        symbols=[cont_symbol],
        schema=SCHEMA,
        start=start_utc,
        end=end_utc,
        stype_in="continuous",
    )

    # --- Cost quote FIRST, always printed (acceptance criterion 1) -------------
    cost = client.metadata.get_cost(**request)
    size = client.metadata.get_billable_size(**request)
    print(f"Cost quote for {args.symbol} {args.date} {SCHEMA} "
          f"[{SESSION_OPEN}-{SESSION_END} ET]:")
    print(f"  billable size: {size:,} bytes")
    print(f"  estimated cost: ${cost:.4f} USD")

    if args.quote_only:
        return 0
    if cost > args.max_cost:
        print(f"error: quoted ${cost:.4f} exceeds --max-cost ${args.max_cost:.2f}; "
              f"aborting. Re-run with a higher --max-cost to proceed.",
              file=sys.stderr)
        return 1

    out_dir = BARS_DIR / args.symbol
    out_path = out_dir / f"{args.date}_{SCHEMA}.parquet"
    if out_path.exists() and not args.force:
        print(f"Parquet already exists: {out_path} (use --force to re-pull).")
        return 0

    # --- Pull ------------------------------------------------------------------
    print(f"Pulling {cont_symbol} {start_utc.isoformat()} -> {end_utc.isoformat()} ...")
    data = client.timeseries.get_range(**request)
    frame = data.to_df(price_type="float")  # ts_event index in UTC, prices as float

    if frame.empty:
        print("error: no bars returned for that window/symbol.", file=sys.stderr)
        return 1

    # Convert UTC -> exchange-local, DST-correct, and expose an explicit column.
    frame = frame.reset_index()  # ts_event becomes a column (tz-aware UTC)
    frame["ts_event_et"] = frame["ts_event"].dt.tz_convert(EXCHANGE_TZ)

    # Canonical app time `t`: the ET wall clock as epoch seconds (local reading
    # reinterpreted as UTC). This is the single time every layer uses -- Rust feed,
    # TS engine, and Lightweight Charts axis -- so no layer needs timezone logic.
    frame["t"] = (frame["ts_event_et"].dt.tz_localize(None)
                  .astype("int64") // 10**9)

    out_dir.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(out_path, index=False)
    rows = len(frame)
    print(f"Wrote {rows:,} rows -> {out_path}")

    # --- Verify via DuckDB (acceptance criterion 5) ---------------------------
    con = duckdb.connect()
    verify = con.execute(
        "SELECT COUNT(*) AS rows, MIN(ts_event_et) AS first_bar, "
        "MAX(ts_event_et) AS last_bar FROM read_parquet(?)",
        [str(out_path)],
    ).fetchone()
    con.close()
    print(f"DuckDB verify: rows={verify[0]:,} first={verify[1]} last={verify[2]}")

    update_manifest(
        symbol=args.symbol,
        cont_symbol=cont_symbol,
        date=args.date,
        rows=rows,
        cost=cost,
        size=size,
        path=out_path.relative_to(REPO_ROOT).as_posix(),
    )
    return 0


def update_manifest(*, symbol, cont_symbol, date, rows, cost, size, path) -> None:
    """Upsert a pull record into the tracked manifest (SPEC decision 13)."""
    manifest = {"schema_version": 1, "pulls": []}
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text())

    record = {
        "dataset": DATASET,
        "symbol": symbol,
        "resolved_symbol": cont_symbol,
        "stype_in": "continuous",
        "schema": SCHEMA,
        "date": date,
        "session_et": f"{SESSION_OPEN.isoformat(timespec='minutes')}-"
                      f"{SESSION_END.isoformat(timespec='minutes')}",
        "rows": rows,
        "billable_bytes": int(size),
        "cost_usd": round(float(cost), 6),
        "path": path,
        "pulled_at": datetime.now(ZoneInfo("UTC")).isoformat(timespec="seconds"),
    }

    key = (symbol, date, SCHEMA)
    manifest["pulls"] = [
        r for r in manifest["pulls"]
        if (r["symbol"], r["date"], r["schema"]) != key
    ]
    manifest["pulls"].append(record)
    manifest["pulls"].sort(key=lambda r: (r["symbol"], r["date"], r["schema"]))

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Manifest updated: {MANIFEST_PATH.relative_to(REPO_ROOT).as_posix()}")


if __name__ == "__main__":
    raise SystemExit(main())
