# ORB/IB Practice Simulator — Design Spec

A local, single-user practice environment for rehearsing Opening Range Breakout (ORB)
and Initial Balance (IB) strategies on the first two hours of the NY index-futures open
(NQ/MNQ and ES/MES). It replays real historical sessions candle-by-candle, lets you
commit a written plan, execute trades under forward-only pressure with honest fills,
then review and receive AI coaching graded on **process, not outcome**.

The bet: a feedback loop that grades whether you *traded the plan you committed to before
you knew the outcome* — something no P&L screen or replay tool gives a solo trader.

---

## 1. Locked decisions (the design record)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Replay granularity | **1-second OHLCV** (Databento per-second aggregate schema, not raw tick). **1s is the floor — do not go sub-second** (see §2.1) |
| 2 | Symbols | Two price series only: **Nasdaq** and **S&P**. Pull the **minis** (NQ, ES) as source of truth; micro (MNQ/MES) is a multiplier toggle, not separate data |
| 3 | Fill model | Working market/limit/stop-entry orders. Commissions + slippage modeled from day one |
| 4 | Ambiguous bars (stop AND target touched in one second) | **Tick-resolve** that second's real sequence; **pessimistic fallback** (assume stop first) when ticks unavailable |
| 5 | Display | 1-minute candles, right-most candle **forms live** off the 1s clock; dropdown to faster charts |
| 6 | Playback | **Hard wall**: forward-only attempt (no rewind/peek) → free-scrub review unlocks only after flatten/end-of-day |
| 7 | Speed controls (attempt) | Pause, single-bar step, 1×/5×/30×/skip-to-next-minute, and **jump-to-my-marked-level**. All forward-only |
| 8 | Levels | Objective levels (PDH/PDL, prior-week H/L, prior-month H/L, overnight H/L, developing IB, POC/VAH/VAL for prior day/week/month) **auto-computed**. RTH-only profiles by default, ETH toggle |
| 9 | Prep phase | **Graded gate**: draw discretionary zones + write bias + mark intended levels, *then commit* to unlock the attempt. Prep record feeds the grade |
| 10 | Grade philosophy | **Process-primary, three axes**: (1) plan adherence, (2) execution quality, (3) outcome — outcome de-weighted daily, aggregated at module level |
| 11 | Deployment | **Local-first.** No server, no redistribution |
| 12 | Storage | DuckDB-over-Parquet for bars; per-day JSON for records (git source of truth); SQLite optional as a *derived* local index |
| 13 | Sync | **git** tracks records + a data manifest only. Bars are a disposable local cache, regenerated from Databento on pull. Bars are gitignored |
| 14 | First build | **Ruthless one-day vertical slice** (full spine on a single day) before any module/calendar/profile scaffolding |

### Contract multipliers (decision 2)
Same 0.25 tick and identical candles across all four; only PnL math differs.

| Contract | $/point | $/tick (0.25) |
|----------|---------|---------------|
| NQ  | $20 | $5.00 |
| MNQ | $2  | $0.50 |
| ES  | $50 | $12.50 |
| MES | $5  | $1.25 |

Micro↔mini is a one-line multiplier applied to a single shared price series. Build once.

---

## 2. Data architecture

Two tiers, both from Databento `GLBX.MDP3`. Volume is tiny for personal use — first 2h of
one index over ~18 months sits comfortably inside the free signup credit.

**Cost reality.** Historical data is metered per uncompressed byte ($/GB varies by schema),
with **$125 free credits** that only deplete on usage beyond them. The OHLCV pulls in both tiers
total **well under 1 GB**, so this project realistically costs **$0 out of pocket**. Call
`Historical.metadata.get_cost(...)` before any pull to get an exact quote first. Do **not** buy
the $179/mo flat subscription — it's only worth it if you later decide to stream full tick all
day, which this design avoids.

**Tier 1 — the engine.** 1-second OHLCV bars, first 2 hours of RTH (09:30–11:30 ET),
for each practice day. Drives the replay and live-forming candle.

**Tier 2 — the context.** 1-*minute* full-session bars **including overnight Globex**,
reaching back far enough to build prior-week and prior-month volume profiles. 1-minute is
ample resolution for a profile — you don't need tick to locate a POC. Daily H/L/C derive
from this for free.

**Ambiguous-bar resolution.** For any 1s bar whose range straddles both a working stop and a
working target, fetch *that second's* ticks and replay true order. Rare, so cost stays near
zero. If the tick fetch is unavailable, fall back to pessimistic (stop fills first).

### Storage + git strategy
- **Bars** → local Parquet, queried via DuckDB. **Never committed.** `.gitignore` them.
- **Records** (plans, trades, journal, grades, module progress) → **one JSON/NDJSON file per
  trading day**. These are the git source of truth. Per-day text files diff and merge cleanly;
  a committed SQLite binary cannot merge and will create unresolvable conflicts across machines.
- **Manifest** → a small tracked file listing which symbol + date ranges have been pulled.
- **Resume on another machine** = `git pull` (records + manifest) → run fetch script
  (rehydrates bars from Databento). Bars are a cache, not data you carry.
- SQLite, if used for fast local queries, is a **derived index rebuilt from the JSON** — never
  the thing git tracks.

### 2.1 Why 1-second is the floor (do not re-litigate)
1-second is the **finest pre-aggregated OHLCV schema Databento offers** — native granularities are
only `ohlcv-1s`, `ohlcv-1m`, `ohlcv-1h`, `ohlcv-1d`. Going to 0.5s or 0.25s is **not** a parameter
change; it requires pulling raw `trades` (tick) data and aggregating bars yourself, which:
- multiplies data volume ~1–2 orders of magnitude (the open is the day's busiest window),
  pushing the pull from sub-GB ($0 inside credit) into multi-GB that actually consumes the credit;
- adds a bar-aggregator you have to own, including sparse/empty sub-second buckets that look bad on a chart;
- buys **nothing** for ORB/IB: fills are already tick-resolved on ambiguous seconds (using true
  print sequence, which is *more* precise than a 0.25s bar), and these strategies aren't sub-second.

Sub-second granularity is the right call for a *different tool* (order-flow / tape-reading scalping),
not this one. **If smoother on-screen motion is ever wanted**, animate the forming candle at
*render time* from the ticks already fetched in the live attempt window — never store sub-second bars.
Stored, graded, replayable data stays clean 1-second bars.

---

## 3. The day spine

Every practice day moves through five sealed phases. The seal is what makes the grade honest.

### Prep (graded)
Day opens locked. Auto-levels shown. You:
- draw discretionary zones / lines,
- write your bias in prose ("expecting a fade of ONH back to prior-day POC"),
- mark the specific levels you *intend* to trade.

Then **commit**. The committed prep is frozen and becomes grading axis 1's reference.

### Attempt (forward-only)
Clock runs at your chosen speed. 1-min candle forms live off the 1s engine. You place
market/limit/stop-entry orders with stops and targets; the fill engine adjudicates them
(§4). **No rewind, no peek.** Speed controls are forward-only. You manage and flatten.

### Review (free-scrub)
Unlocks only after you flatten/end the day. Full 2 hours now scrubbable in both directions,
with your entries, exits, stops, and MAE/MFE annotated on the chart. This is the surface the
grade is computed against and the surface you learn from.

### Journal
Free-text reflection, stored verbatim in the day's JSON. Fed to the grader as-is.

### Grade
Three-axis AI coaching (§5), persisted to the day's JSON.

---

## 4. Fill engine spec

- **Order types:** market, limit, stop-entry. (ORB needs the stop-entry above the range;
  IB fades need the limit.)
- **Limits** fill when price trades through the level.
- **Stops** fill at the stop price plus configurable slippage (default **1 tick**).
- **Commissions + slippage** are modeled from day one — PnL that ignores them trains
  over-trading and lies worst exactly when you scale micro→mini.
- **Ambiguous 1s bar** (range touches both stop and target): tick-resolve that second;
  pessimistic fallback if ticks missing.
- Per trade, the engine records: entry time/price, level traded, logged reason,
  **MAE** (max adverse excursion before it worked), **MFE** (max favorable before exit),
  exit price/reason, R-multiple.

This is the integrity layer. It must never be *more* optimistic than reality.

---

## 5. AI grading design

### Input: a structured digest, never raw bars
The grader does **not** receive 7,200 one-second bars. The engine pre-computes a compact
digest:
- **Per trade:** entry time/price, level, logged reason, MAE, MFE, exit price/reason, R.
- **Day market-structure summary:** did the ORB hold or fail; did price break the IB; where
  it closed relative to your marked levels.
- **Prep plan** (frozen) and **journal text**, verbatim.

This forces the grade to be about decisions, not vibes, and keeps the call cheap.

### Three axes (process-primary)
1. **Plan adherence** — did you trade the plan you committed to in prep, or freelance setups
   you never mapped? (Directly compares frozen prep vs the attempt's trade tape.)
2. **Execution quality** — *independent of result*: entry at a real level, logical stop,
   consistent size, rule-based vs emotional management.
3. **Outcome** — tracked but **de-weighted on any single day**; aggregated across the module
   to answer the only question outcome should answer: *does this process show edge over 20+
   trades?*

A clean plan followed flawlessly that still got stopped → **high** score, "loss was paid-for
and correct." A plan abandoned, revenge-traded, stumbled into green → **low** score despite the
win. At module level, beautiful execution that bleeds money escalates to "your edge or your
levels are the problem" — a more advanced diagnosis than any P&L screen gives.

### Model / API
- Local config holds your Anthropic API key (never leaves the machine).
- Call the standard Messages endpoint (`/v1/messages`). Docs: https://docs.claude.com/en/api/overview
- **Default model: `claude-sonnet-4-6`** — strong structured reasoning, fast, economical for a
  per-day grading call. Offer **`claude-opus-4-8`** as an option for deeper end-of-module
  coaching where you want richer diagnosis.
- Have the model return **structured JSON** (the three axis scores + per-axis notes); parse and
  store it in the day's JSON record.

---

## 6. Stack

- **Build environment:** Claude Code.
- **Bars:** Parquet on disk, queried with **DuckDB** (scans months of 1s bars for a profile in
  milliseconds).
- **Records:** per-day JSON/NDJSON (git source of truth); optional **SQLite** derived index.
- **Charting:** candlestick lib with a live-updating last bar (e.g. TradingView Lightweight
  Charts) — must support forming the right-most candle tick-by-tick.
- **Data vendor:** Databento (`GLBX.MDP3`), pay-as-you-go historical, free signup credit.
- **AI:** Anthropic Messages API, models per §5.
- **Sync:** git for records + manifest; bars gitignored and regenerated.

---

## 7. Build order (the prudent sequence)

The failure mode for a build this rich is spending months on module-progression UI before
ever taking one graded practice trade. So:

**Slice 0 — one day, end to end.** Pick a single historical day. Build the *entire spine*:
prep gate → forward-only attempt with working orders + honest tick-resolved fills → flatten →
review scrub → journal → three-axis grade → persisted to that day's JSON. No calendar, no
modules, no profiles.

> The build risk lives almost entirely in two engines — the **playback engine** (forming the
> 1-min candle from the 1s clock, forward-only, with speed controls) and the **fill engine**
> (working orders + tick-resolved fills). Slice 0 forces you to nail exactly those two, on one
> day, where they're easiest to debug.

**Prove the fill engine on a nasty day first — not a clean one.** Before trusting a single
grade, validate the tick-resolve + pessimistic-fallback logic against a deliberately hostile
session: a violent whipsaw that wicks through a level where a stop and target sit close
together, so the engine is forced to adjudicate which filled first. If fills are honest on
*that* day, they're honest everywhere, and the entire grading layer rests on them being honest.
Build and test against the whipsaw day **before** a clean trending day.

Then, each a low-risk wrapper around a proven core:

1. **Calendar + module structure** — weeks as modules, back to Jan last year, progression
   tracking. Wraps the working loop.
2. **Volume profiles** — the heaviest visual; genuinely deferrable, since horizontal levels
   (PDH/PDL/ONH/ONL) carry most ORB/IB context on their own.
3. **Micro↔mini toggle** — a one-line multiplier; drop it in anytime, effectively free.

---

## 8. Deferred / open items

- Exact Databento schema names and fetch-script details (resolve against their docs at build).
- CME historical-data license questions (personal/local use keeps this minimal; confirm tier).
- Profile rendering approach (volume-at-price binning resolution) — deferred to step 2.
- Whether journal prompts should be templated (e.g. "what would you do differently?") or free.
