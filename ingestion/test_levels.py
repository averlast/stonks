#!/usr/bin/env python
"""Stdlib-only tests for the pure level/value-area math (#13). No pandas/network,
so it runs anywhere: `python ingestion/test_levels.py`. Covers the only non-trivial
computation — the volume-profile value area — plus the high/low helper."""

from __future__ import annotations

import sys

from levels import Bar, high_low, value_area, volume_profile

passed = 0
failed = 0


def check(name: str, cond: bool) -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}")


# --- high_low ----------------------------------------------------------------
bars = [Bar(low=100, high=110, close=105, volume=1), Bar(low=95, high=108, close=100, volume=1)]
check("high_low spans all bars", high_low(bars) == (110, 95))
check("high_low of empty is None", high_low([]) is None)

# --- volume_profile ----------------------------------------------------------
# A single bar spanning [100, 106) with bin_width 2 covers bins 50,51,52 -> volume
# split three ways.
prof = volume_profile([Bar(low=100, high=105.9, close=103, volume=30)], 2.0)
check("volume_profile splits a bar across its bins", prof == {50: 10.0, 51: 10.0, 52: 10.0})

# --- value_area --------------------------------------------------------------
# Build a peaked profile: lots of volume around 200, thinning outward. Each bar is
# a single price (low==high) so it lands in exactly one bin (bin_width 1 -> bins are
# integer prices; center = price + 0.5).
def at(price: float, vol: float) -> Bar:
    return Bar(low=price, high=price, close=price, volume=vol)


peaked = [
    at(196, 1),
    at(197, 2),
    at(198, 5),
    at(199, 8),
    at(200, 20),  # POC
    at(201, 8),
    at(202, 5),
    at(203, 2),
    at(204, 1),
]
va = value_area(peaked, 1.0, va_fraction=0.70)
assert va is not None
poc, vah, val = va
# Total volume 52, target 36.4. Expand from bin 200 (vol 20): tie 199/201 -> up 201
# (28), then 199 (36), still < 36.4 so tie 198/202 -> up 202 (41) -> stop. VA spans
# bins 199..202 -> centers 199.5 .. 202.5, POC center 200.5.
check("value_area POC is the heaviest bin center", poc == 200.5)
check("value_area VAH is the top VA bin center", vah == 202.5)
check("value_area VAL is the bottom VA bin center", val == 199.5)
check("value_area VAL < POC < VAH", val < poc < vah)

# Ties expand upward (deterministic): a flat profile takes the upper neighbour first.
flat = [at(10, 1), at(11, 1), at(12, 1), at(13, 1)]
va2 = value_area(flat, 1.0, va_fraction=0.5)
assert va2 is not None
check("flat profile picks a POC and encloses >= target upward", va2[1] >= va2[0] >= va2[2])

# Empty / volumeless -> None.
check("value_area of no bars is None", value_area([], 1.0) is None)
check("value_area of zero-volume bars is None", value_area([at(5, 0)], 1.0) is None)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
