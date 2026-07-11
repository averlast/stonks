#!/usr/bin/env python
"""Ingest one day's 1-second OHLCV bars to local Parquet (GitHub issue #1).

Pulls the first two hours of RTH (09:30-11:30 America/New_York) 1-second OHLCV
bars for one symbol/day from Databento GLBX.MDP3, converts UTC to exchange-local
time (DST-correct), and writes a gitignored Parquet file queryable via DuckDB.

It also computes the day's true PRE-SESSION LEVELS (prior-day + overnight high/low)
from cheap 1-minute history and writes them as a small tracked answer key for the
hidden-level drill (Option C / issue #7 dependency, ADR-0003 amendment).

Design record: SPEC.md decisions 1/2/12/13, ADR-0001 (isolated Python ingestion).
Bars/ticks are a disposable local cache and are never committed; the manifest and
the derived level numbers are tracked (raw history stays local — license-safe).

Usage:
    python ingestion/fetch_day.py                      # NQ 2024-08-05 (whipsaw day)
    python ingestion/fetch_day.py --symbol ES --date 2024-08-05
    python ingestion/fetch_day.py --quote-only         # cost quote, no pull
    python ingestion/fetch_day.py --no-ticks --no-levels  # 1s bars only
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date as date_cls, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import databento as db
import duckdb
from dotenv import load_dotenv

# --- Fixed design constants (SPEC decisions 1, 2; ADR-0001) --------------------
DATASET = "GLBX.MDP3"          # CME Globex MDP 3.0
SCHEMA = "ohlcv-1s"            # 1-second OHLCV is the floor (SPEC 2.1)
EXCHANGE_TZ = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
SESSION_OPEN = time(9, 30)     # RTH open, ET
SESSION_END = time(11, 30)     # first 2h of the open (SPEC 2, tier 1)
RTH_CLOSE = time(16, 0)        # RTH close, ET — bounds the prior-day range
GLOBEX_EVENING = time(18, 0)   # Globex reopen, ET — starts the overnight session

# Pre-session levels (Option C / issue #7 dependency, ADR-0003 amendment). The
# true pre-session levels a trader marks blind — computed from cheap 1-minute
# history, not the 1s feed, and written as a small TRACKED answer key (derived
# numbers only; the raw history stays a gitignored cache).
LEVELS_SCHEMA = "ohlcv-1m"
LEVELS_LOOKBACK_DAYS = 5        # enough to reach the prior RTH day across a weekend

REPO_ROOT = Path(__file__).resolve().parent.parent
BARS_DIR = REPO_ROOT / "data" / "bars"        # gitignored cache
LEVELS_DIR = REPO_ROOT / "data" / "levels"    # tracked answer key (JSON, numbers only)
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
    p.add_argument("--no-ticks", action="store_true",
                   help="Skip the raw-trades pull (bars only).")
    p.add_argument("--no-levels", action="store_true",
                   help="Skip computing the true pre-session levels answer key.")
    return p.parse_args()


def session_window_utc(day: datetime.date) -> tuple[datetime, datetime]:
    """Return the [09:30, 11:30) ET window as tz-aware UTC datetimes (DST-correct)."""
    start_et = datetime.combine(day, SESSION_OPEN, tzinfo=EXCHANGE_TZ)
    end_et = datetime.combine(day, SESSION_END, tzinfo=EXCHANGE_TZ)
    return start_et.astimezone(UTC), end_et.astimezone(UTC)


def levels_window_utc(day: date_cls) -> tuple[datetime, datetime]:
    """History window for computing pre-session levels: from midnight ET a few
    days before the practice day up to the 09:30 open (never past it — these are
    levels that exist *before* the session, so no lookahead). Returns UTC."""
    start_et = datetime.combine(day - timedelta(days=LEVELS_LOOKBACK_DAYS),
                                time(0, 0), tzinfo=EXCHANGE_TZ)
    end_et = datetime.combine(day, SESSION_OPEN, tzinfo=EXCHANGE_TZ)
    return start_et.astimezone(UTC), end_et.astimezone(UTC)


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
        print(f"Bars already exist: {out_path} (use --force to re-pull).")
    else:
        # --- Pull bars --------------------------------------------------------
        print(f"Pulling {cont_symbol} {start_utc.isoformat()} -> {end_utc.isoformat()} ...")
        frame = client.timeseries.get_range(**request).to_df(price_type="float")
        if frame.empty:
            print("error: no bars returned for that window/symbol.", file=sys.stderr)
            return 1

        # Convert UTC -> exchange-local, DST-correct, and expose an explicit column.
        frame = frame.reset_index()  # ts_event becomes a column (tz-aware UTC)
        frame["ts_event_et"] = frame["ts_event"].dt.tz_convert(EXCHANGE_TZ)

        # Canonical app time `t`: the ET wall clock as epoch seconds (local reading
        # reinterpreted as UTC). The single time every layer uses -- Rust feed, TS
        # engine, and Lightweight Charts axis -- so no layer needs timezone logic.
        frame["t"] = (frame["ts_event_et"].dt.tz_localize(None)
                      .astype("int64") // 10**9)

        out_dir.mkdir(parents=True, exist_ok=True)
        frame.to_parquet(out_path, index=False)
        rows = len(frame)
        print(f"Wrote {rows:,} rows -> {out_path}")

        # --- Verify via DuckDB (acceptance criterion 5) -----------------------
        con = duckdb.connect()
        verify = con.execute(
            "SELECT COUNT(*) AS rows, MIN(ts_event_et) AS first_bar, "
            "MAX(ts_event_et) AS last_bar FROM read_parquet(?)",
            [str(out_path)],
        ).fetchone()
        con.close()
        print(f"DuckDB verify: rows={verify[0]:,} first={verify[1]} last={verify[2]}")

        update_manifest(
            symbol=args.symbol, cont_symbol=cont_symbol, date=args.date,
            schema=SCHEMA, rows=rows, cost=cost, size=size,
            path=out_path.relative_to(REPO_ROOT).as_posix(),
        )

    if not args.no_ticks:
        fetch_ticks(client, cont_symbol, request, args, out_dir)
    if not args.no_levels:
        fetch_levels(client, cont_symbol, args, day)
    return 0


def fetch_ticks(client, cont_symbol, base_request, args, out_dir) -> None:
    """Pull the same window's raw trades for ambiguous-bar resolution (ADR-0004).

    Stored as a per-day tick cache alongside the 1s bars: an adjudication-only
    side input, never rendered or fed to the chart. Columns: `t` (canonical second
    bucket, matching the bars), `ts` (true UTC nanoseconds for within-second
    ordering), and `price`.
    """
    req = {**base_request, "schema": "trades"}
    tick_path = out_dir / f"{args.date}_trades.parquet"
    if tick_path.exists() and not args.force:
        print(f"Ticks already exist: {tick_path} (use --force to re-pull).")
        return

    cost = client.metadata.get_cost(**req)
    print(f"Ticks cost quote: ${cost:.4f} USD")
    if cost > args.max_cost:
        print(f"error: tick quote ${cost:.4f} exceeds --max-cost; skipping ticks.",
              file=sys.stderr)
        return

    print(f"Pulling trades for {cont_symbol} ...")
    tf = client.timeseries.get_range(**req).to_df(price_type="float")
    if tf.empty:
        print("warning: no trades returned for that window.", file=sys.stderr)
        return

    tf = tf.reset_index()
    ts_et = tf["ts_event"].dt.tz_convert(EXCHANGE_TZ)
    out = tf[["price"]].copy()
    out["t"] = ts_et.dt.tz_localize(None).astype("int64") // 10**9
    out["ts"] = tf["ts_event"].astype("int64")  # true UTC ns, for ordering
    out = out[["t", "ts", "price"]].sort_values("ts").reset_index(drop=True)
    out.to_parquet(tick_path, index=False)
    print(f"Wrote {len(out):,} trades -> {tick_path}")

    update_manifest(
        symbol=args.symbol,
        cont_symbol=cont_symbol,
        date=args.date,
        schema="trades",
        rows=len(out),
        cost=cost,
        size=int(client.metadata.get_billable_size(**req)),
        path=tick_path.relative_to(REPO_ROOT).as_posix(),
    )


def fetch_levels(client, cont_symbol, args, day: date_cls) -> None:
    """Compute the true pre-session levels for the day and write a tracked answer
    key (Option C / #7 dependency, ADR-0003 amendment).

    These are levels that exist *before* 09:30, so the hidden-level drill can score
    a trader's blind marks. Minimal real set for the first cut:
      - PDH / PDL: prior RTH day (09:30-16:00 ET) high / low
      - ONH / ONL: overnight Globex session [prior 18:00 ET, 09:30 ET) high / low
    Computed from 1-minute bars (~60x cheaper than the 1s feed). The raw history
    is discarded; only the derived numbers are committed (license-safe). PW/PM H/L,
    prior Value Areas, and the Asia/London split (ET windows still TBD) layer on
    later against the same schema.
    """
    start_utc, end_utc = levels_window_utc(day)
    req = dict(dataset=DATASET, symbols=[cont_symbol], schema=LEVELS_SCHEMA,
               start=start_utc, end=end_utc, stype_in="continuous")

    out_path = LEVELS_DIR / f"{args.symbol}-{args.date}.json"
    if out_path.exists() and not args.force:
        print(f"Levels already exist: {out_path} (use --force to recompute).")
        return

    cost = client.metadata.get_cost(**req)
    size = client.metadata.get_billable_size(**req)
    print(f"Pre-session levels cost quote ({LEVELS_SCHEMA}, "
          f"{LEVELS_LOOKBACK_DAYS}d lookback): ${cost:.4f} USD")
    if cost > args.max_cost:
        print(f"error: levels quote ${cost:.4f} exceeds --max-cost; skipping levels.",
              file=sys.stderr)
        return

    print(f"Pulling {LEVELS_SCHEMA} history for pre-session levels ...")
    frame = client.timeseries.get_range(**req).to_df(price_type="float")
    if frame.empty:
        print("warning: no history returned; cannot compute levels.", file=sys.stderr)
        return

    frame = frame.reset_index()
    et = frame["ts_event"].dt.tz_convert(EXCHANGE_TZ)
    frame["et"] = et
    frame["et_date"] = et.dt.date
    frame["mins"] = et.dt.hour * 60 + et.dt.minute  # ET minutes since midnight

    levels: list[dict] = []
    open_min, close_min = 570, 960  # 09:30, 16:00 ET

    # --- Prior RTH day (PDH/PDL) ----------------------------------------------
    rth = frame[(frame["mins"] >= open_min) & (frame["mins"] < close_min)
                & (frame["et_date"] < day)]
    prior_date = None
    if rth.empty:
        print("warning: no prior RTH session in window; PDH/PDL unavailable.",
              file=sys.stderr)
    else:
        prior_date = max(rth["et_date"])
        prior = rth[rth["et_date"] == prior_date]
        levels.append(_level("PDH", "Prior day high", prior["high"].max()))
        levels.append(_level("PDL", "Prior day low", prior["low"].min()))

    # --- Overnight Globex session (ONH/ONL) -----------------------------------
    on_start = datetime.combine(day - timedelta(days=1), GLOBEX_EVENING, tzinfo=EXCHANGE_TZ)
    on_end = datetime.combine(day, SESSION_OPEN, tzinfo=EXCHANGE_TZ)
    overnight = frame[(frame["et"] >= on_start) & (frame["et"] < on_end)]
    if overnight.empty:
        print("warning: no overnight bars in window; ONH/ONL unavailable.",
              file=sys.stderr)
    else:
        levels.append(_level("ONH", "Overnight high", overnight["high"].max()))
        levels.append(_level("ONL", "Overnight low", overnight["low"].min()))

    if not levels:
        print("error: computed no levels; not writing an empty answer key.",
              file=sys.stderr)
        return

    payload = {
        "schema_version": 1,
        "symbol": args.symbol,
        "resolved_symbol": cont_symbol,
        "date": args.date,
        "computed_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source_schema": LEVELS_SCHEMA,
        "prior_rth_date": prior_date.isoformat() if prior_date else None,
        "overnight_et": f"{on_start.isoformat(timespec='minutes')} -> "
                        f"{on_end.isoformat(timespec='minutes')}",
        "levels": levels,  # the drill's answer key: mark blind, score on commit
    }
    LEVELS_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    marks = ", ".join(f"{lv['id']} {lv['price']}" for lv in levels)
    print(f"Wrote {len(levels)} pre-session levels -> {out_path}")
    print(f"  {marks}")

    update_manifest(
        symbol=args.symbol, cont_symbol=cont_symbol, date=args.date,
        schema=LEVELS_SCHEMA, rows=len(frame), cost=cost, size=int(size),
        path=out_path.relative_to(REPO_ROOT).as_posix(),
        session_et=f"{LEVELS_LOOKBACK_DAYS}d lookback -> {SESSION_OPEN.isoformat(timespec='minutes')}",
    )


def _level(level_id: str, label: str, price: float) -> dict:
    """One pre-session level entry for the answer key."""
    return {"id": level_id, "label": label, "kind": "pre_session",
            "price": round(float(price), 2)}


def update_manifest(*, symbol, cont_symbol, date, schema, rows, cost, size, path,
                    session_et: str | None = None) -> None:
    """Upsert a pull record into the tracked manifest (SPEC decision 13)."""
    manifest = {"schema_version": 1, "pulls": []}
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text())

    record = {
        "dataset": DATASET,
        "symbol": symbol,
        "resolved_symbol": cont_symbol,
        "stype_in": "continuous",
        "schema": schema,
        "date": date,
        "session_et": session_et or
                      f"{SESSION_OPEN.isoformat(timespec='minutes')}-"
                      f"{SESSION_END.isoformat(timespec='minutes')}",
        "rows": rows,
        "billable_bytes": int(size),
        "cost_usd": round(float(cost), 6),
        "path": path,
        "pulled_at": datetime.now(ZoneInfo("UTC")).isoformat(timespec="seconds"),
    }

    key = (symbol, date, schema)
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
