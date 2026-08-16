# Asia evening playbook: Pre-Tokyo range replaces the Asia ORB; value areas auto-computed

## Status
accepted

## Context & decision
The user is adopting an Asia-evening playbook (from a trader transcript, 2026-08-15) and will
trade it roughly two evenings a week — on **both** NQ and gold, superseding the gold-only
Sunday/Wednesday scope. The playbook: mark the prior session's VAH/VAL/POC and the H/L of the
Globex-open-to-Tokyo-open window, then trade **liquidity sweeps** of those levels at the
**Tokyo open** (20:00 ET), when Asia volume actually arrives. The first two hours (18:00–20:00)
are accumulation, not a tradeable open. Previously all of these levels were hand-marked nightly
with TradingView's fixed-range Volume Profile tool plus horizontal lines.

Decided, 2026-08-15:

1. **Retire the Asia 18:00 5m ORB** from `orb-gold.pine`. ADR-0010 principle 2 ("an opening
   range is drawn only for a session the user trades at its open") now cuts the other way:
   under this playbook nobody trades the 18:00 open — the traded event is the Tokyo-open sweep.
   Same treatment the London ORB got. No Tokyo ORB either: the transcript's Tokyo open is an
   *event time* at which the already-frozen levels are watched, not a new breakout band.
2. **Add the Pre-Tokyo range** (CONTEXT.md; labels `PT H` / `PT L`) to **both** per-instrument
   files, honoring the ADR-0010 split. Anatomy reuses the windowed ORB renderer: window
   [18:00–20:00 ET), span to 03:00 (both tunable), developing-dotted while forming, frozen at
   the Tokyo open, optional shade, midpoint toggle **default off** (the playbook uses only H/L).
3. **Auto-compute prior-session VAH/VAL/POC in Pine**, in both files — a deliberate *partial
   reversal* of ADR-0010 principle 4 ("no homemade profiles, use native TV tools"). The
   distinction: the dropped VRVP was a visible-range *judgment* tool, which native TV does
   better; prior-session value areas are *deterministic objective Levels* (CONTEXT.md) that the
   native fixed-range VP can compute but cannot automate as a recurring anchored computation —
   the nightly hand-dragging is exactly the labor being deleted.
4. **Profile scope is per instrument** (transcript-tested, now in CONTEXT.md "Value Area"):
   index — prior **NY RTH** session (09:30–16:00 ET); gold — prior **full ETH day**
   (18:00→17:00 ET). Value area = 70% of session volume; scope windows, VA%, and bin size all
   tunable.
5. **Mechanism**: 1m intrabars via `request.security_lower_tf`, each bar's volume spread
   uniformly across tick-sized price bins over its H–L; at session close, POC = max-volume bin
   (tie → nearest session midpoint), VAH/VAL by the standard expand-from-POC algorithm to 70%;
   freeze and hold until the next session close (Friday's values naturally carry through Sunday
   evening — no weekend special-casing).
6. **Visibility class**: VAH/VAL/POC join the always-on prior-period family (like PDH/PDL),
   not the intraday-only group — with a group toggle and per-line toggles.

## Considered options
- **Keep the Asia ORB as a default-off toggle** — rejected: settings-panel clutter is what
  ADR-0010 exists to kill; if the 18:00 open is ever traded again, principle 2 says re-add it
  that day.
- **Keep hand-marking with the native fixed-range VP tool** — rejected: recurring nightly
  manual work, and the point of this change is deleting it.
- **All work in `orb-gold.pine` only** — rejected: the playbook is traded on NQ too, and
  ADR-0010's per-instrument split also lets each file default its own profile scope.
- **Window the VA lines to the Asia session only** — rejected: the same prior-session levels
  are objective Levels for the NY morning; one computation serves both.

## Consequences
- The profile engine is copied into both files, like the ORB renderer — same accepted drift
  risk, same escape hatch (extract a Pine library if it hurts).
- Pine's VAH/VAL/POC land within a few ticks of the native fixed-range VP, not tick-exact
  (1m-bar uniform distribution vs finer data). Acceptable for sweep logic; known discrepancy
  if cross-checked against the drawing tool.
- `security_lower_tf`'s ~100k-intrabar cap means the lines render only on recent history
  (~2–3 months of 1m data) — irrelevant live.
- The permission lamp needs no changes: its per-chart session-VWAP anchor input already covers
  the Asia session (1800-0300), and it is instrument-agnostic. The transcript's "VWAP" during
  Asia is the existing 18:00-anchored daily VWAP in both files.
- The sim is unaffected — Asia evenings are live-chart-only (CONTEXT.md "Trading window").
- CONTEXT.md updated: **Pre-Tokyo range** (new term), **Opening Range** (Asia ORB retired),
  **Trading window** (both instruments, ~2 evenings/week), **Value Area** (per-instrument
  live-chart scope).
