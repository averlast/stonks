# Project state — read this first

Local, single-user **ORB/IB practice simulator**: replay the first 2h of the NY index-futures
open (NQ/ES), commit a plan, trade forward-only with honest fills, then get AI coaching graded on
**process, not outcome**. Status: **design complete, build not started.**

## Where everything lives
- **`SPEC.md`** — the 14 locked decisions + data/fill/grading architecture.
- **`CONTEXT.md`** — the domain glossary (phases, setups, levels, sweeps, scaling, R). Keep current.
- **`docs/adr/0001–0008`** — every design decision and *why*. Read these before changing anything.
- **`docs/study/method.html`** — the trader's own method, for studying (not app design).
- **GitHub `averlast/stonks` issues #1–#19** — the build plan (tracer-bullet vertical slices,
  `agent-ready` label). Issue # = slice #; "Blocked by" links resolve.

## How to resume in a fresh session
1. Skim this file, then `SPEC.md` §1 (locked decisions) and the ADR titles.
2. The critical path to a first graded trade: **#1 → #2 → #3 → (#4 ∥ #5) → #6/#7 → #8.**
3. Build discipline (ADR-0006): prove the **playback + fill engines on the whipsaw day first**,
   then layer on the full environment.

## Next action — issue #1 (Databento ingestion)
- **Whipsaw test day: NQ, 2024-08-05** (yen-carry-unwind session; violent two-way open).
  *Not yet verified against data* — confirming the 9:30–11:30 window actually straddles a
  stop+target in one second is part of #1. Swap days cheaply if it's too one-directional.
- **Keys:** create a gitignored **`.env`** with `DATABENTO_API_KEY=…` and `ANTHROPIC_API_KEY=…`
  (never paste keys into chat/commits). Ingestion runs `metadata.get_cost(...)` before any pull.
- Session-window note: **FOMC = 2pm ET (outside our window); CPI = 8:30am ET (pre-open)** — so a
  volatility/reversal day beats an event day for stressing the *morning* engine.

## Open parameters — decided in shape, numbers still to tune (not forks)
- Bias bull/bear/chop thresholds, scored over the **2h window** (ADR-0003).
- Per-symbol level tolerance for the hidden-drill precision score (a "few points" ≠ same on NQ vs ES).
- Asia/Tokyo & London session **ET windows** (CONTEXT marks TBD).
- Commission per contract (+ default slippage already set: 1 tick on stops).
- The Journal prompt list (structured prompts, ADR-0003 / CONTEXT).
- Volume-zone overlap threshold (~20% of top 3–4 ranges — profiles module).
- AI models: default `claude-sonnet-4-6`, `claude-opus-4-8` for deep end-of-module coaching (SPEC §5).

## Deferred by design (post-core, in order)
Calendar/module/progression (#17) → volume-profile histogram polish (#14) → micro↔mini (#19).
Base-rate stats (#18) computed **as-of the practiced day, no lookahead** (ADR-0008).
