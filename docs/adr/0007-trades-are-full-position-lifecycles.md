# Trades are full position lifecycles; R anchors to the first entry

## Status
accepted (reverses the slice-0 deferrals in Q3/Q9 discussion)

## Context & decision
Scaling out (partials, runners) and scaling in (adding on confirmation) are core to how the
user actually trades — the A+ "best of both worlds" entry is literally a scale-in. So the earlier
"one entry, one exit" simplification and the "no add/flip" rule are dropped. A **Trade** is now a
full position lifecycle: from flat, through any number of entry adds and partial exits, back to
flat, recorded as an ordered list of fills (price, size, time, reason). One-entry/one-exit is the
degenerate case, so the event-sourced record (ADR-0005) needs no structural change.

**R-multiple under scaling:** 1R = the dollar risk of the *first* entry (initial size ×
initial-stop distance × $/pt); total R = total realized $ ÷ that 1R. Adds do not retroactively
rewrite the risk originally committed, consistent with anchoring R to the initial stop.

**Sequencing (engine-first guardrail, per ADR-0006):** the fill engine is proven on the whipsaw
day with single-bracket trades first — the risky logic is OCO + tick-resolve adjudication, which
is identical at any size — then scale-in/out layers onto the proven core.

## Consequences
- Position state must track average entry, running size, and per-leg realized R.
- MAE/MFE are measured across the whole lifecycle, not per leg.
