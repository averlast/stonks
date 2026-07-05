# Simulation clock is authoritative; bars are fed one second at a time

## Status
accepted

## Context & decision
The playback and fill engines meet at the clock, and decision §4 requires fills that are
"never more optimistic than reality." Therefore **simulation time, not render time, is
authoritative**: a monotonic sim clock advances in 1-second steps and **every 1s bar of the
session passes through the fill engine exactly once, in order**, regardless of playback
speed. Speed controls (1×/5×/30×, single-bar step, skip-to-next-minute, jump-to-marked-level)
change only how fast sim-seconds map to wall-clock and how often the renderer paints — they
**never** change which bars the fill engine evaluates. "Skip-to-next-minute" and
"jump-to-level" are *fast-forwards* (process every intervening bar at max speed, then pause),
never seeks. The forming 1-minute candle, MAE/MFE, and the chart are all *views* of what the
sim clock has already processed.

To make decision 6's "hard wall (no rewind/peek)" a real boundary rather than a promise, the
**bar feed is server-authoritative**: Rust owns the full day's bars and exposes a gated
"next sim-second" feed, so the frontend fill engine only ever holds past+current bars — future
price is physically absent from the browser until the clock reaches it. The TypeScript engine
still owns all cadence/speed logic; it requests the next second, and Rust refuses to reveal
the future. Free-scrub is unlocked (the whole day handed over) only after flatten/end-of-day.

## Considered options
- **UX-only wall** — load the whole day into the frontend and just don't render ahead. Simpler,
  but the no-peek wall is defeated by opening devtools, which silently corrupts every grade.

## Consequences
- One narrow Rust→frontend channel for the gated feed; the frontend cannot implement rewind
  or peek during an attempt even if it tried.
- A within-bar straddle of both a working stop and target escalates to tick-resolution (§4);
  a single touched level fills unambiguously from the 1s OHLC.

## Amendment — multi-timeframe live-forming (supersedes decision 5's framing)
Decision 5 ("1-minute candle + dropdown to faster charts") understates the requirement. The
trading method is inherently multi-timeframe: **5m is the confirmation trigger, 1m is the entry,
15m carries the Opening Range**, and 30m/1h/4h carry trend/level context. The single 1s stream
**folds live into every timeframe simultaneously** — each timeframe's right-most candle forms off
the same clock; the gated feed is unchanged. 1m/5m/15m are co-primary and all higher timeframes
are viewable. Adding timeframes is a bucket-size parameter, so cost is low.
