#!/usr/bin/env python
"""Offline test for the catalog windowing (#13) — no network. Builds a synthetic
1-minute ET frame with KNOWN highs/lows placed in specific day/week/month/session
buckets, then asserts compute_catalog picks the right ones. Needs pandas, so run it
with the repo venv:  .venv/Scripts/python.exe ingestion/test_catalog.py
"""

from __future__ import annotations

import sys
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

from fetch_day import compute_catalog

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
rows: list[dict] = []


def add(dt_et: datetime, high: float, low: float, vol: float = 1.0) -> None:
    """One 1-minute bar at an ET wall-clock minute (stored as tz-aware UTC, the
    Databento convention compute_catalog expects to tz_convert back to ET)."""
    rows.append({
        "ts_event": dt_et.astimezone(UTC),
        "open": (high + low) / 2, "high": high, "low": low,
        "close": (high + low) / 2, "volume": vol,
    })


DAY = date(2024, 8, 5)  # a Monday

# Prior day = Fri 2024-08-02 RTH. Put a distinctive high/low in its session.
add(datetime(2024, 8, 2, 10, 0, tzinfo=ET), high=19000, low=18000)
add(datetime(2024, 8, 2, 11, 0, tzinfo=ET), high=18900, low=17950)  # PDL 17950, PDH 19000

# Same week as the prior day (week of Jul 29–Aug 2) — prior WEEK should span Mon–Fri
# of that week and exceed the single prior day.
add(datetime(2024, 7, 29, 10, 0, tzinfo=ET), high=19500, low=17000)  # PWH 19500, PWL 17000
add(datetime(2024, 7, 31, 12, 0, tzinfo=ET), high=19100, low=17800)

# Prior MONTH = July. A July bar OUTSIDE the prior week must set the month extremes.
add(datetime(2024, 7, 10, 13, 0, tzinfo=ET), high=20000, low=16000)  # PMH 20000, PML 16000

# A bar OUTSIDE RTH (08:00 ET) must be ignored by the period H/L (RTH-only).
add(datetime(2024, 8, 2, 8, 0, tzinfo=ET), high=99999, low=1, vol=1)

# Overnight into the practice day: Asia (18:00 prior .. 03:00) and London (03:00 ..
# 09:30) get distinct extremes so we can tell them apart.
add(datetime(2024, 8, 4, 20, 0, tzinfo=ET), high=17600, low=17400)  # Asia
add(datetime(2024, 8, 5, 4, 0, tzinfo=ET), high=17700, low=17300)   # London (also ON extreme)

frame = pd.DataFrame(rows)
et = frame["ts_event"].dt.tz_convert(ET)
frame["et"] = et
frame["et_date"] = et.dt.date
frame["mins"] = et.dt.hour * 60 + et.dt.minute

levels, prior_date, on_start, on_end = compute_catalog(frame, DAY, "NQ")
by = {lv["id"]: lv["price"] for lv in levels}

passed = failed = 0


def check(name: str, cond: bool) -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}  (got {by if 'level' in name else ''})")


check("prior_date is the Friday RTH day", prior_date == date(2024, 8, 2))
check("PDH is the prior day's RTH high", by.get("PDH") == 19000)
check("PDL is the prior day's RTH low", by.get("PDL") == 17950)
check("PWH spans the prior calendar week", by.get("PWH") == 19500)
check("PWL spans the prior calendar week", by.get("PWL") == 17000)
check("PMH spans the prior calendar month", by.get("PMH") == 20000)
check("PML spans the prior calendar month", by.get("PML") == 16000)
check("period H/L ignores the pre-RTH 08:00 outlier", by.get("PDH") != 99999)
check("AsiaH from the 20:00 ET bar", by.get("AsiaH") == 17600)
check("LonH from the 04:00 ET bar", by.get("LonH") == 17700)
check("ONH is the overnight extreme (London high)", by.get("ONH") == 17700)
check("ONL is the overnight extreme (London low)", by.get("ONL") == 17300)
check("prior-session value area present", "PS_POC" in by)
check("prior-week value area present", "PW_POC" in by)
check("value-area VAL <= POC <= VAH (prior session)",
      by["PS_VAL"] <= by["PS_POC"] <= by["PS_VAH"])
check("session H/L are kind=session_hl",
      all(lv["kind"] == "session_hl" for lv in levels if lv["id"].startswith(("ON", "Asia", "Lon"))))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
