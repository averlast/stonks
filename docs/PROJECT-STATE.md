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

## Next action — issue #2, second half (Tauri + Rust gated feed)
Issue **#1 DONE.** Issue **#2 is HALF DONE**: the portable TypeScript playback engine is built
and tested in a Vite dev harness (`app/`); the remaining half is the Tauri shell + Rust
`next_sim_second` gated feed that makes the no-peek wall real (ADR-0002). **That half needs the
Rust + MSVC build-tools toolchain installed** (not yet present). Then #3 (fill engine).

### #2 first-half outcome (2026-07-09) — "TS engine first" path (user-chosen)
- `app/` = Vite + TS + Lightweight Charts v5. Run: `cd app && npm run dev` → http://localhost:5173.
- **Engine** (`app/src/engine/`): `playback.ts` authoritative 1s sim clock (`step()` is the only
  bar-processing path; speed sets only the timer delay — ADR-0002 invariant, unit-tested);
  `aggregator.ts` folds 1s → 1m/5m/15m live-forming candles; `barFeed.ts` gated `BarFeed`
  interface (`DevJsonFeed` now, Rust drop-in later). Tests: `npm test` (4 passing).
- **Dev data**: `ingestion/export_dev_json.py` dumps the gitignored parquet → gitignored
  `app/public/data/NQ-2024-08-05.json` (dev-only; the shipped app reads via Rust, never this).
- **Remaining for #2**: scaffold Tauri, move bars ownership into Rust, expose `next_sim_second`
  as the gated feed, point `barFeed.ts` at it via `invoke()`. Verify no future bars reach the
  frontend and the app launches as a desktop window.

### #1 outcome (2026-07-09)
- **Ingestion script:** `ingestion/fetch_day.py` (isolated Python per ADR-0001; `.venv/` +
  `ingestion/requirements.txt`). Runs `metadata.get_cost` first (~$0.03, 400 KB — trivially
  inside the free credit), pulls `ohlcv-1s` for 09:30–11:30 ET via **continuous front-month
  symbology** (`NQ.c.0`, `stype_in=continuous`), writes gitignored Parquet to `data/bars/`, and
  upserts a tracked `data/manifest.json`. Timestamps stored in America/New_York (DST-correct,
  EDT −04:00). DuckDB verify: **7,188 rows** (≈7,200; ~12 thin seconds had no trade).
- **Whipsaw day CONFIRMED — keep NQ 2024-08-05.** First-2h range **680 pts**, net +540;
  first second alone spans 36 pts; **994 one-second bars ≥8 pt, 442 ≥10 pt.** Stops/targets
  placed within ~30 pt *will* be straddled in one second — the hostile input #3/#4 must resolve.
- **Keys:** `.env` (gitignored) has `DATABENTO_API_KEY`. `ANTHROPIC_API_KEY` still to add before
  the grading slice (#8). Never paste keys into chat/commits.
- **Not committed yet** — working tree holds `.gitignore`, `ingestion/`, `data/manifest.json`.
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
