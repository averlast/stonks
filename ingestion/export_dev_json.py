#!/usr/bin/env python
"""Export a day's 1s bars to a compact JSON for the browser dev harness.

DEV-ONLY. The shipped app never does this: Rust owns the Parquet and gates the
feed one sim-second at a time (ADR-0002). This dump exists purely so the portable
TypeScript playback engine can be driven in a Vite dev server before the Tauri +
Rust shell is wired up (issue #2, "TS engine first" path). The output is derived
from the gitignored bars cache and is itself gitignored.

Chart-time trick: Lightweight Charts renders UTC on the axis and has no timezone
support. We emit `t` as the *exchange-local wall clock reinterpreted as UTC epoch
seconds*, so the axis reads 09:30-11:30 without a timezone layer. Ordering is
preserved, which is all the sim clock needs.

Usage:
    python ingestion/export_dev_json.py --symbol NQ --date 2024-08-05
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parent.parent
BARS_DIR = REPO_ROOT / "data" / "bars"
OUT_DIR = REPO_ROOT / "app" / "public" / "data"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--symbol", default="NQ")
    p.add_argument("--date", default="2024-08-05")
    args = p.parse_args()

    src = BARS_DIR / args.symbol / f"{args.date}_ohlcv-1s.parquet"
    if not src.exists():
        print(f"error: missing {src}; run fetch_day.py first.")
        return 1

    con = duckdb.connect()
    # `t` (canonical app time) is baked into the parquet by fetch_day.py.
    rows = con.execute(
        """
        SELECT t, open AS o, high AS h, low AS l, close AS c,
               CAST(volume AS BIGINT) AS v
        FROM read_parquet(?)
        ORDER BY t
        """,
        [str(src)],
    ).fetchall()
    con.close()

    bars = [
        {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}
        for (t, o, h, l, c, v) in rows
    ]
    payload = {
        "symbol": args.symbol,
        "date": args.date,
        "schema": "ohlcv-1s",
        "count": len(bars),
        "bars": bars,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{args.symbol}-{args.date}.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {len(bars):,} bars -> {out.relative_to(REPO_ROOT).as_posix()} "
          f"({out.stat().st_size/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
