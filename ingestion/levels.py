#!/usr/bin/env python
"""Pure level & value-area math for the pre-session answer key (#13).

No pandas, no network — just arithmetic over plain sequences of `Bar`s — so the
risky part (the volume-profile value area) unit-tests with the stdlib alone
(`python ingestion/test_levels.py`). `fetch_day.py` does the Databento pull and
the DataFrame windowing, then hands already-filtered bar lists to these helpers.

Levels are NO LONGER scored (the precision score was removed 2026-07-13); they are
drawn as reference lines. So this module only has to place them correctly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Bar:
    """One OHLCV bar (1-minute, from the Tier-2 history). Only low/high bound the
    ranges; close is unused today but kept so callers pass whole bars."""
    low: float
    high: float
    close: float
    volume: float


# --- Session windows (ET minutes since midnight) ------------------------------
# Open params — CONTEXT marks the exact Asia/London ET windows TBD. These are the
# common futures conventions for NQ/ES; tune per hand-calibration later.
#   Overnight (ON): the whole Globex evening -> RTH open, [18:00 prior, 09:30).
#   Asia/Tokyo:     [18:00 prior, 03:00) ET — Globex evening through the Tokyo close.
#   London:         [03:00, 09:30) ET — London open through the NY open ("pre-market
#                   low" ~ London low, CONTEXT).
# Windows that wrap past midnight are expressed as (start_min, end_min) with
# start > end meaning "start today .. end next day"; `fetch_day` applies them to the
# dated overnight span, so the wrap is handled there, not here.
SESSION_WINDOWS = {
    "ON": (18 * 60, 9 * 60 + 30),
    "Asia": (18 * 60, 3 * 60),
    "London": (3 * 60, 9 * 60 + 30),
}

# Value-area price-bin width per symbol (points). A few ticks: fine enough for a
# reference line without thousands of bins over a week. Open param.
VA_BIN = {"NQ": 2.0, "MNQ": 2.0, "ES": 1.0, "MES": 1.0}
DEFAULT_VA_BIN = 2.0

# Fraction of total volume enclosed by the value area (the standard 70%).
VA_FRACTION = 0.70


def high_low(bars: list[Bar]) -> tuple[float, float] | None:
    """(high, low) over the bars, or None if empty."""
    if not bars:
        return None
    return max(b.high for b in bars), min(b.low for b in bars)


def volume_profile(bars: list[Bar], bin_width: float) -> dict[int, float]:
    """Distribute each bar's volume evenly across the price bins its [low, high]
    spans, keyed by integer bin index (floor(price / bin_width)). A single-price
    bar drops all its volume in one bin. This is the standard volume-profile
    approximation from OHLCV (no intrabar tape)."""
    prof: dict[int, float] = {}
    for b in bars:
        lo = math.floor(b.low / bin_width)
        hi = math.floor(b.high / bin_width)
        n = hi - lo + 1
        share = b.volume / n if n else 0.0
        for k in range(lo, hi + 1):
            prof[k] = prof.get(k, 0.0) + share
    return prof


def value_area(
    bars: list[Bar], bin_width: float, va_fraction: float = VA_FRACTION
) -> tuple[float, float, float] | None:
    """(POC, VAH, VAL) as bin-CENTER prices, from the bars' volume profile.

    Expands out from the point of control, each step taking the heavier adjacent
    bin, until `va_fraction` of total volume is enclosed. Returns None if empty or
    volumeless. Bin centers (not edges) so a line sits mid-bin at the chosen
    granularity."""
    if not bars:
        return None
    prof = volume_profile(bars, bin_width)
    if not prof or sum(prof.values()) <= 0:
        return None

    keys = sorted(prof)
    vols = [prof[k] for k in keys]
    total = sum(vols)
    target = total * va_fraction

    poc_i = max(range(len(keys)), key=lambda i: vols[i])
    lo = hi = poc_i
    acc = vols[poc_i]
    while acc < target and (lo > 0 or hi < len(keys) - 1):
        below = vols[lo - 1] if lo > 0 else -1.0
        above = vols[hi + 1] if hi < len(keys) - 1 else -1.0
        # Tie -> take the upper side (deterministic).
        if above >= below:
            hi += 1
            acc += vols[hi]
        else:
            lo -= 1
            acc += vols[lo]

    def center(k: int) -> float:
        return round((k + 0.5) * bin_width, 2)

    return center(keys[poc_i]), center(keys[hi]), center(keys[lo])
