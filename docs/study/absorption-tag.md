# How to trade the reads — quick guide

Plain-words companion to the **Absorption tag** (ADR-0013) and **VWAP stretch** (CONTEXT.md).
Grade the process, not the outcome.

## What's on the chart
- **Keep:** the ORBs, Peachy (SMA regime + EMA cloud), Liquidity map, volume pane.
- **Gone:** RSI, CVD, Permission lamp.
- **New (lamp's slot):** the **Absorption tag**.

## The two live reads

### 1. VWAP stretch — "how far from fair value, in % of a normal day (ADR)?"
NQ normal day ≈ **245 pts**. Distance from VWAP ÷ that.

| Stretch | Means | Do |
|---|---|---|
| **under 10%** (<~25 pts) | not stretched | chasing is fine |
| **10–20%** | neutral | — |
| **over 20%** (>~50 pts) | stretched | **don't chase** — ~6 in 10 it snaps back to VWAP; wait for the pull-in, then go *with* the trend |
| **gold, over 75%** of evening ADR | extreme | real fade — reverts hard |

### 2. Absorption tag — fires only when price is at a level, at the bar close
The mark tells you three things in one glance, so you never have to decode a colour *or* go check VWAP:
- **word = what to do + a caret for direction.** `FADE <level>` → absorbed, trade the reversal off the level. `PUSH <level>` → flow ran through, continuation, don't fade. `▲` = long, `▼` = short.
- **★ = strong flow** (how sure). Heavy + very one-sided footprint.
- **suffix = location vs VWAP** (how far). `· prime` = stretched fade (room back to VWAP, best fades); `· scalp!` = stretched push (you're chasing → take a scalp). Nothing = near VWAP.
- ★ and suffix stack. `PUSH ▲ PTH ★ · scalp!` = strong continuation but late → scalp, don't run it.
- No mark = nothing worth acting on (that's the point). Colour just reinforces (red=FADE, blue=PUSH).

**Levels it fires at** (each togglable): PDH/PDL, ONH/ONL, Pre-Tokyo H/L, session VWAP, and **ORB edges** (H/L/mid — index 09:30–09:45, gold 18:00–18:05). No round numbers, no SMAs (both tested/decided out).

**Settings:** one **Market** toggle (Index/Gold) sets the VWAP anchor, ADR window, proximity, and trade window. One shared strength set; proximity is per-instrument (gold's bars are smaller). A **trade-window filter** means it only tags during your hours — no dead-hour noise.

Read it as: **word+caret** = do this / which way, **★** = trust it, **prime/scalp!** = size up / keep it small. Chart **index on 5-minute, gold on 2-minute**, Market toggle to match.

## One-glance decision
| VWAP stretch | Tag at the level | Do |
|---|---|---|
| <10% | Running | go with it, chase ok |
| >20% | Absorbed | **best fade** — stretched *and* rejected |
| >20% | Running | don't fade; wait for pull to VWAP, then continue |
| any | no tag | no level in play — stand down |

## Windows (also the tag's trade-window filter)
- **NQ/ES:** 10:00–13:00 ET (post-IB; the 9:45 ORB is out of the live day).
- **Gold evening:** measure from **6pm**, trade the run-up **7:30–8:55pm**, **step aside before the Shanghai bell (~9pm)** — the bell's direction is a coin flip and too volatile to trade responsibly.

## Honesty caveat
The tag *renders* the absorption read faithfully, but absorption-vs-thin-book is **unproven on
history** (no stored delta / volume-at-row). Validating that it actually pays needs a Databento
re-fetch with size + aggressor side. Until then: a read you trust by eye, not a proven edge.
