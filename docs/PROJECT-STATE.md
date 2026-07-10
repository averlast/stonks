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

## Next action — confirm #3 order flow, then #4 (tick-resolved straddles)
Issues **#1 and #2 DONE. #3 (fill engine) BUILT + unit-verified; awaiting a visual confirm of
the order-ticket UI before closing.** Then #4 (replace the pessimistic straddle with true
tick-resolution — extends ingestion to pull that day's ticks, ADR-0004).

### #3 outcome (2026-07-10) — fill engine (the integrity layer, SPEC §4)
- **`app/src/engine/fillEngine.ts`** — working market/limit/stop-entry orders each with an OCO
  stop+target bracket. Adjudicates each 1s bar in clock order: limits/targets fill clean, stops
  and market/stop-entries take 1-tick slippage, OCO cancels the sibling, a straddle bar (stop AND
  target in one second) resolves **pessimistically (stop first)** and is flagged `exitMethod:
  "pessimistic"`. Trade record carries fills, avg entry, exit, level, reason, MAE/MFE, PnL,
  commissions, and **R anchored to the initial stop** (1R = first-entry $ risk, ADR-0007).
  Single-bracket only for now; fills are an ordered list so scale-in/out layers on unchanged.
- **`app/src/engine/contracts.ts`** — NQ/MNQ/ES/MES specs; `DEFAULT_FILL_CONFIG` = 1-tick
  slippage, $2.50/contract/side commission (both tunable open params).
- **Tests**: `cd app && npm test` → 16 passing (4 aggregator + 12 fill engine covering every #3
  criterion: each entry type, OCO, pessimistic straddle+flag, commission/slippage in PnL, a flat
  stop-out landing slightly worse than −1R, MAE/MFE, short mirror, guards).
- **UI** (`main.ts` + `index.html`): order-ticket sidebar (side/type/entry/stop/target/size),
  Place + Flatten, live position box (unreal R/$, MAE/MFE), trades list (R, $, ⚠ pessimistic
  flag, totals), chart bracket price-lines + fill markers. Typechecks + prod-builds; app boots
  clean (`load_day` 7188 bars). **Not yet driven by hand — user to eyeball placing a trade.**

### Toolchain (installed 2026-07-10 — no longer a blocker)
- **Rust** via rustup (user-local, `~/.cargo`, MSVC target), **MSVC C++ Build Tools** (VCTools
  workload), **WebView2** (pre-existing). Run the app: `cd app && npx tauri dev` (needs
  `~/.cargo/bin` on PATH). Plain browser harness still works: `npm run dev` → :5173.

### #2 outcome (2026-07-10)
- **`app/` = Vite + TS + Lightweight Charts v5 frontend; `app/src-tauri/` = Tauri v2 + Rust.**
- **Engine** (`app/src/engine/`): `playback.ts` authoritative 1s sim clock (`step()` the only
  bar-processing path; speed sets only the timer delay — ADR-0002 invariant, unit-tested);
  `aggregator.ts` folds 1s → 1m/5m/15m live candles; `barFeed.ts` picks the Rust `TauriFeed`
  under Tauri, `DevJsonFeed` in a plain browser. TS tests: `cd app && npm test` (4 passing).
- **Rust gated feed** (`app/src-tauri/src/`): `bars.rs` reads the parquet (pure-Rust
  arrow/parquet) using the baked-in `t` column; `lib.rs` owns the bars + a forward-only cursor
  and exposes `load_day` / `next_sim_second` / `reset_feed`. The webview only ever gets the next
  second — no-peek wall enforced in Rust (ADR-0002). Rust tests: `cd app/src-tauri &&
  cargo test --lib` (2 passing: real parquet load + gate invariant). Boot log confirms IPC:
  `load_day NQ 2024-08-05: 7188 bars`.
- **Canonical time**: `fetch_day.py` now bakes a `t` column (ET wall clock as epoch seconds) into
  the parquet, so Rust + TS + chart all use one integer with zero timezone code.
- **Still deferred from #2** (not blocking #3): bundled-app bars path (dev resolves
  repo/data/bars via CARGO_MANIFEST_DIR); macOS launch is architecturally supported but untested
  locally (Windows-only dev box).

### For #3 (fill engine) — where to build
Order/fill logic is portable TS → lives in `app/src/engine/` alongside playback, driven by the
same 1s `Tick` stream. Straddle bars use the pessimistic fallback for now (stop first); true
tick-resolution is #4. Model commissions + 1-tick slippage from day one. Record entry/exit,
level, reason, MAE, MFE, R (R anchored to the initial stop).

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
