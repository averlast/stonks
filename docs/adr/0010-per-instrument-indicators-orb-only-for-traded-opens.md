# Per-instrument TradingView indicators; opening ranges only for sessions traded at the open

## Status
accepted

## Context & decision
The single companion indicator (ADR-0009) had grown to cover every instrument and session the
user touches — NY 15m/30m ORBs, a London ORB, an Asia ORB, IB, three VWAPs, period/session H/L,
and a homemade VRVP — and both the chart and the ~50-input settings panel had become illegible.
The user now trades two instrument families with different session structures: index (NQ/ES,
NY open) and gold (GC: COMEX 08:20 ET open, plus the ~18:00 ET Asia open on Sunday/Wednesday
evenings).

Decided, 2026-08-11:

1. **Split into two per-instrument files** — `tradingview/orb-index.pine` (NY 15m + 30m ORBs,
   IB, 09:30 session VWAP) and `tradingview/orb-gold.pine` (NY 08:20 15m ORB, Asia 18:00 5m ORB,
   08:20 session VWAP) — each also carrying daily/weekly VWAP and period/session H/L. The old
   combined file is deleted. TradingView saves indicator settings per chart, so visual clutter
   was solvable either way; what a single file cannot fix is settings-panel clutter, because
   Pine cannot hide input groups dynamically.
2. **An opening range is drawn only for a session the user trades at its open.** Other sessions
   contribute their H/L as liquidity levels only. This kills the London ORB (the user is not
   awake for the London open; its 03:00–03:15 box is stale by 09:30) while keeping London H/L —
   the "pre-market low" read.
3. **ORB anatomy is uniform**: high/low/midpoint lines (each toggleable, labeled), role-based
   line styles (solid high / dashed low / dotted mid, global inputs), and an optional
   transparent shaded box. Lines and shading are **windowed** — they start at the ORB window's
   open and extend right until the session ends — not full-chart-width (`extend.both`), which
   was the main source of the visual mess. The IB block keeps its existing anatomy.
4. **Drop the homemade extras in favor of native TradingView tools** now that the user is on
   Premium: the polyline VRVP is replaced by the built-in visible-range Volume Profile, and
   ad-hoc anchored VWAPs use the built-in Anchored VWAP drawing tool rather than `input.time`
   plumbing. The indicators keep only standing VWAP anchors (session / daily / weekly).

## Considered options
- **One file with an instrument dropdown** — rejected: Pine inputs are static, so the settings
  panel would still show every instrument's inputs everywhere, which is the complaint.
- **One lean file configured per chart** — rejected for the same reason at smaller scale; also
  couldn't default the session VWAP anchor per instrument (09:30 vs 08:20).
- **Keeping the London ORB since London H/L is drawn** — rejected: an H/L is a liquidity
  reference that stays relevant all morning; an ORB is an entry-timing tool for a session
  traded live at its open. Session levels ≠ session opening ranges.

## Consequences
- The shared ORB renderer is copied between the two files — accepted drift risk; if they
  diverge painfully, extract a Pine library then.
- ADR-0009's scope statement (live chart follows market convention) now applies to both files.
- The Asia ORB defaults ON in the gold file (it is a gold-dedicated surface); the sim is
  unaffected — gold is live-chart-only (CONTEXT.md "Trading window").
- If the user starts trading the London open, principle 2 says add a London ORB that day — to
  the file of whatever instrument they trade it on.
