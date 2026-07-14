#!/usr/bin/env python
"""Ingest one day's 1-second OHLCV bars to local Parquet (GitHub issue #1).

Pulls the first two hours of RTH (09:30-11:30 America/New_York) 1-second OHLCV
bars for one symbol/day from Databento GLBX.MDP3, converts UTC to exchange-local
time (DST-correct), and writes a gitignored Parquet file queryable via DuckDB.

It also computes the day's PRE-SESSION LEVEL CATALOG (period + session H/L and prior
value areas) from cheap 1-minute history and writes them as a small tracked answer
key of reference lines (Option C / issue #7; expanded in #13). See ingestion/levels.py.

Design record: SPEC.md decisions 1/2/12/13, ADR-0001 (isolated Python ingestion).
Bars/ticks are a disposable local cache and are never committed; the manifest and
the derived level numbers are tracked (raw history stays local — license-safe).

Usage:
    python ingestion/fetch_day.py                      # NQ 2024-08-05 (whipsaw day)
    python ingestion/fetch_day.py --symbol ES --date 2024-08-05
    python ingestion/fetch_day.py --quote-only         # cost quote, no pull
    python ingestion/fetch_day.py --no-ticks --no-levels  # 1s bars only
    python ingestion/fetch_day.py --no-ticks --force-levels  # refresh only the catalog
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

from levels import (
    Bar,
    DEFAULT_VA_BIN,
    SESSION_WINDOWS,
    VA_BIN,
    high_low,
    value_area,
)

# --- Fixed design constants (SPEC decisions 1, 2; ADR-0001) --------------------
DATASET = "GLBX.MDP3"          # CME Globex MDP 3.0
SCHEMA = "ohlcv-1s"            # 1-second OHLCV is the floor (SPEC 2.1)
EXCHANGE_TZ = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
SESSION_OPEN = time(9, 30)     # RTH open, ET
SESSION_END = time(11, 30)     # first 2h of the open (SPEC 2, tier 1)
RTH_CLOSE = time(16, 0)        # RTH close, ET — bounds the prior-day range
GLOBEX_EVENING = time(18, 0)   # Globex reopen, ET — starts the overnight session

# Pre-session levels (Option C / issue #7; expanded to the full catalog in #13). The
# objective levels a trader marks against — computed from cheap 1-minute history, not
# the 1s feed, and written as a TRACKED answer key (derived numbers only; the raw
# history stays a gitignored cache). Levels are reference lines, not scored.
LEVELS_SCHEMA = "ohlcv-1m"
RTH_OPEN_MIN, RTH_CLOSE_MIN = 570, 960  # 09:30, 16:00 ET, in minutes since midnight

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
    p.add_argument("--force-levels", action="store_true",
                   help="Recompute just the levels answer key (cheap 1m pull); leaves "
                        "the 1s bars and ticks untouched. Pair with --no-ticks.")
    return p.parse_args()


def session_window_utc(day: datetime.date) -> tuple[datetime, datetime]:
    """Return the [09:30, 11:30) ET window as tz-aware UTC datetimes (DST-correct)."""
    start_et = datetime.combine(day, SESSION_OPEN, tzinfo=EXCHANGE_TZ)
    end_et = datetime.combine(day, SESSION_END, tzinfo=EXCHANGE_TZ)
    return start_et.astimezone(UTC), end_et.astimezone(UTC)


def levels_window_utc(day: date_cls) -> tuple[datetime, datetime]:
    """History window for computing the pre-session catalog: from the first day of
    the PRIOR MONTH (00:00 ET) up to the 09:30 open (never past it — these levels
    exist *before* the session, so no lookahead). The prior-month start guarantees
    prior-day, prior-week and prior-month H/L (and the prior-session / prior-week
    value areas) are all in range. Returns UTC. (#13; was a 5-day lookback.)"""
    start_et = datetime.combine(prior_month_first(day), time(0, 0), tzinfo=EXCHANGE_TZ)
    end_et = datetime.combine(day, SESSION_OPEN, tzinfo=EXCHANGE_TZ)
    return start_et.astimezone(UTC), end_et.astimezone(UTC)


def prior_month_first(day: date_cls) -> date_cls:
    """First calendar day of the month before `day`."""
    return (day.replace(day=1) - timedelta(days=1)).replace(day=1)


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
    """Compute the day's objective pre-session level catalog and write a tracked
    answer key (Option C / #7; expanded to the full catalog in #13).

    These are levels that exist *before* 09:30 — reference lines drawn in Prep (no
    longer scored). Computed from 1-minute Tier-2 history incl. overnight:
      - Period H/L: prior day (PDH/PDL), prior week (PWH/PWL), prior month (PMH/PML),
        over the RTH session(s) 09:30-16:00 ET.
      - Session H/L: overnight (ONH/ONL), Asia (AsiaH/AsiaL) and London (LonH/LonL),
        per SESSION_WINDOWS (levels.py; Asia/London ET windows are open params).
      - Value areas: prior-session and prior-week VAH/VAL/POC (70% volume profile).
    The raw history is discarded; only the derived numbers are committed
    (license-safe). Value-area accuracy on the live/intraday profile is #14.
    """
    start_utc, end_utc = levels_window_utc(day)
    req = dict(dataset=DATASET, symbols=[cont_symbol], schema=LEVELS_SCHEMA,
               start=start_utc, end=end_utc, stype_in="continuous")

    out_path = LEVELS_DIR / f"{args.symbol}-{args.date}.json"
    if out_path.exists() and not (args.force or args.force_levels):
        print(f"Levels already exist: {out_path} "
              f"(use --force-levels to recompute just the catalog).")
        return

    cost = client.metadata.get_cost(**req)
    size = client.metadata.get_billable_size(**req)
    print(f"Pre-session catalog cost quote ({LEVELS_SCHEMA}, "
          f"from {prior_month_first(day).isoformat()} -> {args.date} 09:30): "
          f"${cost:.4f} USD")
    if cost > args.max_cost:
        print(f"error: levels quote ${cost:.4f} exceeds --max-cost; skipping levels.",
              file=sys.stderr)
        return

    print(f"Pulling {LEVELS_SCHEMA} history for the pre-session catalog ...")
    frame = client.timeseries.get_range(**req).to_df(price_type="float")
    if frame.empty:
        print("warning: no history returned; cannot compute levels.", file=sys.stderr)
        return

    frame = frame.reset_index()
    et = frame["ts_event"].dt.tz_convert(EXCHANGE_TZ)
    frame["et"] = et
    frame["et_date"] = et.dt.date
    frame["mins"] = et.dt.hour * 60 + et.dt.minute  # ET minutes since midnight

    levels, prior_date, on_start, on_end = compute_catalog(frame, day, args.symbol)
    if not levels:
        print("error: computed no levels; not writing an empty answer key.",
              file=sys.stderr)
        return

    # Persist the prep-context bars (prior RTH day + overnight, 1m) so the app can
    # show a real chart to mark levels against during Prep (#7). Cache-like and
    # gitignored, same canonical `t` (ET wall clock as epoch seconds) as the 1s
    # bars, so Rust's load_parquet reads it unchanged.
    context_start = (datetime.combine(prior_date, SESSION_OPEN, tzinfo=EXCHANGE_TZ)
                     if prior_date else on_start)
    ctx = frame[(frame["et"] >= context_start) & (frame["et"] < on_end)].copy()
    if ctx.empty:
        print("warning: no prep-context bars to persist.", file=sys.stderr)
    else:
        ctx["t"] = ctx["et"].dt.tz_localize(None).astype("int64") // 10**9
        ctx_path = BARS_DIR / args.symbol / f"{args.date}_presession-1m.parquet"
        ctx_path.parent.mkdir(parents=True, exist_ok=True)
        ctx[["t", "open", "high", "low", "close", "volume"]].to_parquet(ctx_path, index=False)
        print(f"Wrote {len(ctx):,} prep-context bars -> {ctx_path}")

    payload = {
        "schema_version": 2,  # v2: expanded catalog (period/session H/L + value areas)
        "symbol": args.symbol,
        "resolved_symbol": cont_symbol,
        "date": args.date,
        "computed_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source_schema": LEVELS_SCHEMA,
        "prior_rth_date": prior_date.isoformat() if prior_date else None,
        "overnight_et": f"{on_start.isoformat(timespec='minutes')} -> "
                        f"{on_end.isoformat(timespec='minutes')}",
        "levels": levels,  # objective reference lines revealed on Commit (unscored)
    }
    LEVELS_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {len(levels)} pre-session levels -> {out_path}")
    for lv in levels:
        print(f"  {lv['id']:<5} {lv['label']:<16} {lv['price']}")

    update_manifest(
        symbol=args.symbol, cont_symbol=cont_symbol, date=args.date,
        schema=LEVELS_SCHEMA, rows=len(frame), cost=cost, size=int(size),
        path=out_path.relative_to(REPO_ROOT).as_posix(),
        session_et=f"{prior_month_first(day).isoformat()} -> "
                   f"{SESSION_OPEN.isoformat(timespec='minutes')}",
    )


def compute_catalog(frame, day: date_cls, symbol: str):
    """Compute the full pre-session level catalog from a 1-minute history frame that
    already carries `et` (tz-aware ET), `et_date`, and `mins` columns. Pure w.r.t.
    the network (all Databento I/O is done by the caller), so it unit-tests offline
    against a synthetic frame. Returns (levels, prior_date, on_start, on_end).
    """
    va_bin = VA_BIN.get(symbol, DEFAULT_VA_BIN)
    rth_all = frame[(frame["mins"] >= RTH_OPEN_MIN) & (frame["mins"] < RTH_CLOSE_MIN)]

    def rth_in(lo: date_cls, hi: date_cls):
        """RTH rows with et_date in [lo, hi) (a half-open date range)."""
        return rth_all[(rth_all["et_date"] >= lo) & (rth_all["et_date"] < hi)]

    levels: list[dict] = []

    # --- Prior DAY H/L (PDH/PDL) ----------------------------------------------
    prior_rth = rth_all[rth_all["et_date"] < day]
    prior_date = max(prior_rth["et_date"]) if not prior_rth.empty else None
    if prior_date is None:
        print("warning: no prior RTH session in window; PDH/PDL unavailable.",
              file=sys.stderr)
    else:
        _add_hl(levels, "PD", "Prior day", rth_all[rth_all["et_date"] == prior_date])

    # --- Prior WEEK H/L (PWH/PWL) — the calendar week before this week ---------
    week_monday = day - timedelta(days=day.weekday())
    prior_week = rth_in(week_monday - timedelta(days=7), week_monday)
    if prior_week.empty:
        print("warning: no prior-week RTH bars; PWH/PWL unavailable.", file=sys.stderr)
    else:
        _add_hl(levels, "PW", "Prior week", prior_week)

    # --- Prior MONTH H/L (PMH/PML) — the calendar month before this month ------
    prior_month = rth_in(prior_month_first(day), day.replace(day=1))
    if prior_month.empty:
        print("warning: no prior-month RTH bars; PMH/PML unavailable.", file=sys.stderr)
    else:
        _add_hl(levels, "PM", "Prior month", prior_month)

    # --- Session H/L: overnight, Asia, London ---------------------------------
    on_start, on_end = _session_span(day, SESSION_WINDOWS["ON"])
    for sid, label, win in (
        ("ON", "Overnight", SESSION_WINDOWS["ON"]),
        ("Asia", "Asia session", SESSION_WINDOWS["Asia"]),
        ("Lon", "London session", SESSION_WINDOWS["London"]),
    ):
        s_start, s_end = _session_span(day, win)
        seg = frame[(frame["et"] >= s_start) & (frame["et"] < s_end)]
        if seg.empty:
            print(f"warning: no {label} bars in window; {sid}H/{sid}L unavailable.",
                  file=sys.stderr)
        else:
            _add_hl(levels, sid, label, seg, kind="session_hl")

    # --- Value areas: prior session + prior week (VAH/VAL/POC) ----------------
    if prior_date is not None:
        _add_va(levels, "PS", "Prior session",
                rth_all[rth_all["et_date"] == prior_date], va_bin)
    if not prior_week.empty:
        _add_va(levels, "PW", "Prior week", prior_week, va_bin)

    return levels, prior_date, on_start, on_end


def _bars(df) -> list[Bar]:
    """Convert an OHLCV DataFrame slice to the pure `Bar` list `levels.py` expects."""
    return [Bar(low=float(r.low), high=float(r.high), close=float(r.close),
                volume=float(r.volume)) for r in df.itertuples()]


def _session_span(day: date_cls, win: tuple[int, int]) -> tuple[datetime, datetime]:
    """Resolve a SESSION_WINDOWS (start_min, end_min) to dated ET datetimes. A window
    with start_min > end_min wraps past midnight (starts the prior evening)."""
    start_min, end_min = win
    start_day = day - timedelta(days=1) if start_min > end_min else day
    start = datetime.combine(start_day, time(start_min // 60, start_min % 60),
                             tzinfo=EXCHANGE_TZ)
    end = datetime.combine(day, time(end_min // 60, end_min % 60), tzinfo=EXCHANGE_TZ)
    return start, end


def _add_hl(levels: list[dict], prefix: str, label: str, df, kind: str = "period_hl") -> None:
    """Append the high/low pair for a DataFrame slice (e.g. PDH/PDL)."""
    hl = high_low(_bars(df))
    if hl is None:
        return
    high, low = hl
    levels.append(_level(f"{prefix}H", f"{label} high", high, kind))
    levels.append(_level(f"{prefix}L", f"{label} low", low, kind))


def _add_va(levels: list[dict], prefix: str, label: str, df, bin_width: float) -> None:
    """Append VAH/VAL/POC for a DataFrame slice's volume profile (70%)."""
    va = value_area(_bars(df), bin_width)
    if va is None:
        return
    poc, vah, val = va
    levels.append(_level(f"{prefix}_VAH", f"{label} VAH", vah, "value_area"))
    levels.append(_level(f"{prefix}_POC", f"{label} POC", poc, "value_area"))
    levels.append(_level(f"{prefix}_VAL", f"{label} VAL", val, "value_area"))


def _level(level_id: str, label: str, price: float, kind: str = "period_hl") -> dict:
    """One pre-session level entry for the answer key."""
    return {"id": level_id, "label": label, "kind": kind,
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
