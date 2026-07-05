# Base-rate stats are computed as-of the practiced day (no lookahead)

## Status
accepted

## Context & decision
The user's method leans on data-backed priors (in the source videos, a paid tool, Edgeful):
opening-candle continuation %, single-vs-double IB break %, IB retracement depth, IB extension
hit-rates. The historical corpus we already pull can generate these for free, so a **post-core
module** will compute them.

The integrity catch — same family as ADR-0002's no-peek wall: a base rate shown or graded for a
practiced day **must be computed only from data before that day**. Computing it once over the
whole corpus would feed a past decision with future information, corrupting the honesty the app
exists to protect. So base rates are **as-of the practiced day**: a trailing, configurable
lookback ending the day *before* the session. They serve as a **prep aid** (a prior, not today's
outcome, so it doesn't break the blind level-drill) and as a **grade input** (the AI can flag
trading against a strong prior).

## Considered options
- **Compute once over the entire corpus** — simpler and cheaper, but leaks future information
  into past practice decisions; rejected on integrity grounds.

## Consequences
- Base rates are as-of-date, queried per practiced day; DuckDB over the Tier-2 corpus makes the
  trailing-window query cheap.
- Deferred until after the core loop (engine-first discipline, ADR-0006).
