# Fair value gaps as confluence — study results (2026-09-12)

**Verdict: drop the layer.** On NQ, a gap lined up with one of the user's Levels held its first
retest *less* often than a gap standing alone, at every drawing timeframe. Flipped the other way
round, a Level with a gap behind it held about 1–3 points better than a Level without one, which
is inside the noise. The gap adds nothing the Level didn't already say — the same shape as the
round-numbers result (lift ~1.1, rejected). Gold can't be tested this way: its evening levels
blanket the tiny range, so almost every gap counts as lined up and the "alone" bucket is empty.

Script: `analysis/study_fvg.py` (`.venv/Scripts/python.exe analysis/study_fvg.py`). Full raw
output: `analysis/fvg_run.txt`. Data: 4 years of 1m bars, Aug 2022 – Aug 2026, NQ and GC.

## What was measured
- **Gap**: three consecutive bars on the 15m / 30m / 1h where bar 1 and bar 3 don't overlap.
  Middle bar body ≥ 50% of its range. Gap height ≥ 0.5 × the timeframe's 14-bar ATR. Alive from
  birth to the end of the *next* day's trading window; dies on flip or after its third test.
- **Retest**: first time a 1m bar enters the band, inside the trading window (NQ 10:00–13:00 ET,
  gold 19:30–20:55 ET).
- **Hold**: price then travels one gap-height away in the gap's direction before any **15m close
  fully beyond the far edge** (= flip). Unresolved = the window ended first (excluded from rates).
- **Lined up**: a Level sits inside the band or within the absorption tag's proximity of an edge
  (NQ 1.5 pts, gold 0.8 pts), read at the retest bar. NQ Levels: PDH/PDL, ONH/ONL, ORB H/L/mid,
  09:30 VWAP. Gold: PDH/PDL, Pre-Tokyo H/L, 5m + 15m ORB H/L/mid, 18:00 VWAP.
- **Inverse FVG**: after a flip, first return to the band; "reject" = travels one gap-height in
  the failure direction before a 15m close back through.
- **Mirror test**: every in-window Level test, split by whether a live gap was lined up with the
  Level; hold = travel 0.5 × 15m-ATR off the Level before a 15m close 0.5 ATR through it.

## NQ — the deciding tables

First-retest hold rate, lined-up vs alone (defaults):

| TF | lined-up | alone | lift |
|---|---|---|---|
| 15m | 64.6% (330/511), CI 60–69 | 71.2% (242/340), CI 66–76 | **0.91** |
| 30m | 63.7% (153/240), CI 58–70 | 69.3% (133/192), CI 62–75 | **0.92** |
| 1h | 64.8% (57/88), CI 54–74 | 60.2% (56/93), CI 50–70 | 1.08 |

Excluding VWAP (a moving level that is always near price) changes nothing: 0.93 / 0.91 / 0.97.

Inverse FVG, first-return reject rate, lined-up vs alone: 66% vs 71% (15m, N=702), 66% vs 66%
(30m, N=371), 59% vs 63% (1h, N=131). Lifts 0.94 / 0.99 / 0.94.

By Level (15m, the only TF with real counts): ORB mid 69%, ORB high 68%, ONL 66%, VWAP 62%,
ORB low 61%, PDH 58%, PDL 56%, ONH 55%. None beats the alone bucket's 71%.

Mirror test — Level tests **with** a lined-up gap vs **without**:

| TF | with gap | no gap | difference |
|---|---|---|---|
| 15m | 76.6% (N=1727), CI 74.6–78.5 | 75.2% (N=2605), CI 73.5–76.8 | +1.4 pts |
| 30m | 77.3% (N=1330) | 75.0% (N=3002) | +2.3 pts |
| 1h | 78.0% (N=777), CI 74.9–80.8 | 75.2% (N=3555), CI 73.8–76.6 | +2.8 pts |

Intervals overlap at every TF. Even taking the point estimates at face value, a 1–3 point lift on
a ~75% base is not something a trader can act on at one micro.

Size-floor / body sweep (NQ): no cell with meaningful N shows a lift above ~1.1. The only lifts
above 1.2 are 1h gaps at a 1.0 × ATR floor — 39 lined vs 23 alone — noise. Dropping the floor to
zero *raises* the alone bucket's hold rate to 79%, because "hold" is measured in gap-heights and
tiny gaps clear one gap-height trivially. So the raw hold rate is not evidence of an edge either.

## Gold

| TF | lined-up | alone | lift |
|---|---|---|---|
| 15m | 70.1% (204) | 67.9% (28) | 1.03 |
| 30m | 65.0% (40) | 37.5% (8) | 1.73 — N=8 |
| 1h | 2 holds / 4 flips | 0 / 3 | n/a |

Mirror test: 87.5% vs 85.4% (15m), 87.7% vs 85.8% (30m), 86.3% vs 86.3% (1h). Same shape as NQ.
Gold's eleven evening Levels sit inside a range of a few points, so ~88% of gaps are "lined up"
and the comparison has nothing to compare against. The 30m lift of 1.73 rests on eight gaps.

## Chance baseline — is a gap better than a random band at all?
`analysis/fvg_baseline.py` (raw: `analysis/fvg_baseline_run.txt`). Control = the same gap, same
direction, height and birth time, shifted a random 2–5 heights away so it sits at a price the
impulse did *not* skip. Same race, same window.

| | real gaps | shifted controls | lift |
|---|---|---|---|
| NQ 15m | 67.2% (N=851), CI 64–70 | 60.4% (N=586), CI 56–64 | **1.11** |
| NQ 30m | 66.2% (N=432) | 62.8% (N=288) | 1.05 |
| NQ 1h | 62.4% (N=181), CI 55–69 | 48.3% (N=118), CI 40–57 | **1.29** |
| GC 15m | 69.8% (N=232) | 57.5% (N=87) | 1.22 |
| GC 30m / 1h | 60% (48) / 22% (9) | 61% (23) / 50% (6) | noise |

So a gap **alone** does hold modestly above chance — roughly 7 points over a same-size random band
on NQ 15m, 14 on 1h — while a gap **at a Level** (65%) sits barely above the control (60%). Read
together: the impulse's origin is a slightly-better-than-random place for a pullback to pause, and
putting it next to a Level does not improve that; if anything Levels are where the two-sided fight
happens and gaps there flip more. Note the control itself "holds" 60%, not 50% — the hold
definition (one gap-height up vs a full-gap-plus-close down) is asymmetric, so the raw 67% is
mostly definition, and the honest edge is the *difference*.

**User call on this (2026-09-12): build it as a standalone place, not as confluence.** The gaps
are drawn on the liquidity map as ranges that can sway a decision or warn of a reversal (the
flipped band), never as a trigger, and with no lined-up highlight since that distinction failed.
The ~7–14 point lean is the honest size of the effect; no expectancy claim is made for it.

## Caveats
- No chance baseline for the *absolute* hold rate; the study is relative (lined vs alone, with vs
  without) by design, and both comparisons come out flat.
- The hold race must finish inside the same trading window, so late retests land as unresolved —
  heavy on 1h gaps (125 of 306 on NQ). That trims N but shouldn't bias lined vs alone.
- Proximity is the tag's per-instrument setting, not tuned here. A wider tolerance would move
  more gaps into "lined up", not create an edge that isn't there.
- The 15m-close flip rule and one-gap-height hold target were fixed by doctrine before the run,
  not fitted. Fitting them would be the start of curve-fitting a result the first pass rejected.

## What this leaves standing
The doctrine's *reading* of a gap (an impulse's origin; a flipped gap as a trapped crowd) is not
wrong as a story — it just adds no measurable hold probability beyond the Level it sits next to.
Levels alone, and the absorption tag at them, remain the read. Nothing goes on the chart.
