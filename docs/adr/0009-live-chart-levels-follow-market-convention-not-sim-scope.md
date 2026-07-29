# The TradingView indicator draws levels per market convention; the sim keeps its RTH-only answer key

## Status
accepted

## Context & decision
Building a companion Pine Script (TradingView indicator) to auto-draw the same **objective-level**
catalog the sim computes (OR, IB, VWAP, period H/L, session H/L), so prep and live trading share
one visual language. The question: should the live-chart levels use the same scope as the sim's
answer key — full prior **RTH** session(s) (09:30–16:00 ET), per CONTEXT.md's existing
"Prior-session levels" definition — or the scope the rest of the market actually watches?

Decided: **the two surfaces deliberately diverge.** The live chart draws PDH/PDL and prior-week/
-month H/L from the full **ETH** day (18:00→17:00 ET) and prior **calendar** week/month — market
convention, matching what other participants are watching, because the user trades against them.
The sim's answer key stays **RTH-only**, unchanged — it exists to drill the user's own 09:30–11:30
practice window, not to model the broader market.

This follows from the **Trading window** concept (CONTEXT.md): the user's live trading window is
narrow (09:30 to ~12:00 ET at the latest), but the levels that matter are the ones held by
participants who trade the full day. Marking per the sim's narrower RTH scope on the live chart
would show levels nobody else is reacting to.

## Considered options
- **Match the sim's RTH-only scope on the live chart too**, for one-glance parity between prep and
  live trading — rejected: parity would be internally consistent but wrong against the market the
  user is actually trading, which defeats the point of a live-chart indicator.
- **Change the sim's answer key to ETH/calendar scope** to match the live chart — rejected: the sim
  is deliberately scoped to the user's own practiced window (ADR-0002's no-peek/RTH discipline);
  widening it would blur what the drill is testing.

## Consequences
- On a gap day, PDH/PDL (etc.) will differ between the sim's Prep reveal and the live TradingView
  chart — expected, not a bug to reconcile.
- Session H/L (Asia/London/overnight) is *not* part of this split — those windows are shared
  between both surfaces (see CONTEXT.md), since there's no "market convention" alternative to
  diverge toward for sub-sessions.
- CONTEXT.md's "Prior-session levels" and new "Trading window" entries are the source of truth for
  this split; keep them in sync if either surface's scope changes.
