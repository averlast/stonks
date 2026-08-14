# Permission lamp: the playbook state machine emits vetoes, never entries

## Status
accepted

## Context & decision
The playbook's discipline rules (Auction bias gate, Entry gates, Coil rule, two-strike switch)
had matured to the point of being largely deterministic, raising the question of encoding them
as a live decision aid — up to and including a bot. The documented failure modes are taking
trades the rules ban (the 2026-08-12 long-biased reads on a short day), not missing trades the
rules allow; and the judgment half of the playbook (footprint absorption, "the auction has
finished arguing", A+ quality, S/D placement, sizing) has no programmatic inputs.

Decided, 2026-08-14:

1. **Vetoes only.** The artifact — the **Permission lamp** (CONTEXT.md) — displays the regime
   state and the legality of each setup archetype, with reasons. It never emits "enter" or
   "conditions met." A wrong veto fails safe (an unneeded stand-down); a wrong trigger feeds
   the exact impatience the Entry gates exist to kill. The rules themselves are
   pre-commitments that treat in-session self-control as the thing being defended against, so
   the tool must not depend on that self-control to be safe.
2. **The regime state is a total function of computed inputs**: session-VWAP side + slope →
   side state (long-only / short-only / chop / **stand-by** — the price/slope-disagreement
   state, in which nothing is legal); 1h + 4h SMA regimes → ambition by the **unanimity rule**
   (press only when session side, 1h, and 4h all agree; any disagreement = harvest; accepted
   cost: the 4h lags regime turns, forfeiting the first new-trend runner, never the trade).
3. **Setup legality composes from two locks** (direction lock × family lock, CONTEXT.md
   "Setup families") rather than a hand-authored table.
4. **One hand-set input, quarantined**: the two-strike counter (Pine cannot see fills) —
   visibly marked hand-set, its chop override labeled with its cause, challenged at each new
   session's open if carried over nonzero.
5. **Out of scope**: the failed-auction target-map flip (targets are not permissions);
   level-scoped vetoes (third-test, Coil rule) stay on the liquidity map, which shows the
   per-level evidence — the trader joins lamp and map on screen.
6. **Surface**: one instrument-agnostic `tradingview/permission-lamp.pine` (session-VWAP-anchor
   input: index 09:30; gold 08:20 or 18:00), per the liquidity-map precedent — the ADR-0010
   per-instrument split was for structurally different content, which the lamp doesn't have.

## Considered options
- **Vetoes + a "conditions met" channel** — deferred, not rejected: the preconditions are
  mostly shipped code (`computeConfirmation`, sweep markers), but "conditions met" cannot see
  auction resolution, so it systematically flags the first sweep of an unresolved auction —
  arguing against the A+ lesson on the live screen. Reserved as a **sim/Review-only** channel
  (phase 2), where a false positive costs nothing and the sealed session logs let
  machine-said/user-did/how-it-graded be compared. The state space is designed so this channel
  is additive.
- **Full signal machine / bot** — parked: without aggressor-side data or the judgment reads it
  would codify a worse trader than the user and backtest the proxies, not the playbook.
  Revisit only after the phase-2 validator shows the machine agreeing with well-graded trades
  and vetoing badly-graded ones over a real sample.
- **1h-decides ambition** — rejected: press-in-error (holding a runner against a disagreeing
  4h) is expensive; harvest-in-error costs only the runner's tail. Unanimity also keeps press
  rare enough to carry information.
- **Folding price/slope disagreement into chop** — rejected: a stretched pullback through
  VWAP is not a range day; chop fades there are knife-catches. Stand-by is short-lived by
  construction.

## Consequences
- The lamp's trustworthiness rests on every computed input being judgment-free; any future
  input that needs a threshold with real disagreement risk (sweep detection, reclaim speed)
  belongs in the phase-2 sim channel, not the lamp.
- The lamp goes dark (stand-by) during every VWAP reclaim, including the ones that become the
  day's best trend-change entries — deliberately: trading the reclaim is a judgment read at
  structure, which the lamp was never licensed to authorize.
- The sim validator (phase 2) reuses the same state machine as portable TS over the replay
  clock, computes strikes from actual stop-outs (no hand-set input), and can annotate Review
  with the lamp state at each entry — the labeled-data path toward any future bot discussion.
