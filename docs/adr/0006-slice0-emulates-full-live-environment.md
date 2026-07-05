# Slice 0 emulates the full live environment (widens §7's minimal-first)

## Status
accepted

## Context & decision
§7 prescribes a *ruthless* one-day slice that defers the full level catalog, extra timeframes,
and volume profiles, on the theory that build risk lives in the playback + fill engines and
everything else is a distraction. The user's governing principle overrides that framing:
**the simulator must emulate their live trading environment faithfully**, because practicing
against a stripped-down env trains habits that won't transfer. So slice 0 is widened to include:

- **all timeframes** (1m/5m/15m co-primary, 30m/1h/4h context), folded live from the one 1s
  clock (ADR-0002 amendment);
- the **full objective level catalog** + multi-anchor **VWAP**;
- **hand-marked intraday OR/IB** (unscored ritual — ADR-0003 amendment);
- the **volume-profile histogram** (visible-range + fixed-range) **with auto-detected HVN and
  value-area levels** drawn on it.

Still deferred: module/calendar/progression tracking (build step 1) and the micro↔mini toggle.
Scale-in/out is decided separately.

## Mitigation — §7's real point is preserved
§7's genuine risk is *env-building delaying the engine proof*. So the sequence holds the line:
the **playback + fill engines are validated first on the deliberately hostile whipsaw day**
against a minimal level set, and only then does the full environment layer on. Rich end-state,
but the core is still de-risked before the UI grows.

## Consequences
- More upfront build before the first graded trade than §7 envisioned; the whipsaw-day engine
  milestone is the guardrail against that becoming the §7 failure mode.
- The volume-profile histogram is the single heaviest visual; accepted deliberately for fidelity.
