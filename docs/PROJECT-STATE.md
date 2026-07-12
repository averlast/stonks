# Project state — read this first

Local, single-user **ORB/IB practice simulator**: replay the first 2h of the NY index-futures
open (NQ/ES), commit a plan, trade forward-only with honest fills, then get AI coaching graded on
**process, not outcome**. Status: **core loop built through #8 — first graded trade working
end-to-end** (Prep → attempt → Review → grade).

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

## Next action — pick the next enrichment slice (critical path #1–#8 COMPLETE)
Issues **#1–#10 DONE** + on-chart trade management. The full loop runs — **Prep gate** (#7) →
**attempt** (#5) → **Review** (#6) → **grade** (#8). Everything past here is enrichment, not the
spine. **Unblocked now** (every "Blocked by" is in #1–#10):
- **#16 HTF context charts + trend read (30m/1h/4h)** — now unblocked by #9; folds in daily + a
  week of history (the user's real prep process, deferred from #7).
- **#12 Objective level catalog + multi-anchor VWAP** — unblocks the whole profiles chain
  (#13 → #14 → #15). *Note: it's a large slice with a paid-data fork — see the scoping options
  raised 2026-07-12 (intraday OR/IB/VWAP engine is buildable now; expanded scored pre-session
  catalog needs a paid Databento re-pull).*
- **#11 Scale-in / scale-out** — full position lifecycle on top of the fill engine (#3; the fill
  list is already ordered so layers add cleanly — see the #3 note).
- **#17 Calendar + module/progression tracking** — sits directly on the sealed event logs (#8).
- **#18 Base-rate stats, as-of the practiced day** — no-lookahead stats (ADR-0008), on #1 + #8.
- **#19 Micro↔mini multiplier toggle** — the contract-size switch (#3; `CONTRACTS` already has
  MNQ/MES).
Still blocked: **#13/#14/#15** (profiles chain after #12).
**#12 unblocks the most downstream** — start there if unsure.

### #10 outcome (2026-07-12) — confirmation flags + per-trade setup tags (ADR-0003)
At each entry the engine now stamps four OBJECTIVE, deterministic confirmation flags, and each
trade carries a user setup tag; both ride the trade record into the grade digest and the AI
narrates on them (never scores them). Sits directly on #3 (fill engine) + #9 (5m/15m folds).
- **Pure engine** (`app/src/engine/confirmation.ts`, portable TS): `computeConfirmation` over the
  sealed 5m/15m snapshots at entry returns `{ fiveMinCloseBeyond, volumeIncrease, engulfing,
  withHtfTrend, htfTrend }`. 5m is the confirmation timeframe (close-beyond / volume / engulfing),
  15m is the HTF trend. **Entry price stands in for the traded level** (chart-drawn entries carry
  no separate level price) — documented. Per-symbol open params in `CONFIRMATION_CONFIGS`
  (volumeLookback/factor, htfTrendPts; NQ tuned first, mirrors `GRADE_CONFIGS`). `SETUP_TAGS` = the
  six CONTEXT archetypes; `isSetupTag` guard.
- **Fill-engine wiring** (`fillEngine.ts`): `setConfirmationProvider` (injected like the straddle
  resolver, keeps the engine portable) is called the instant an entry fills — so flags are captured
  even on a same-bar whipsaw close. `Position`/`Trade`/`BracketRequest` gained `setupTag?` +
  `confirmation?`; both copy onto the closed `Trade`, so they seal in `trade_closed` and fold back
  with no new event type. No look-ahead: `historyOf(300/900)` is sealed-only; the 5m/15m candle
  containing the entry second is still forming.
- **Digest + prompt** (`digest.ts`, `types.ts`, `grade.ts`): `TradeDigest` carries `setupTag` +
  `confirmation`; `distillTrade` copies them; the system prompt tells the coach to weigh execution
  higher for entries taken WITH confirmation / a matching tag, and flag entries against a flat or
  opposing read — without recomputing the flags.
- **UI** (`main.ts`, `index.html`): a **Setup** `<select>` in the ticket (populated from
  `SETUP_TAGS`) tags the next trade; the position box + trades list render the tag and a compact
  flag read (`5m✓ vol· eng· htf✓ (up)`). Provider wired from the engine's 5m/15m history — **works
  in browser dev too** (the aggregators run regardless of feed; only the AI half needs Tauri).
- **Tests**: TS `npm test` → 55 (+10 confirmation: each flag true/false + thin-history + determinism
  + vocabulary; +2 fillEngine: provider stamps at entry, tag+flags ride to the trade, and a
  no-provider trade still closes; +1 grade: tag+flags reach the digest and the prompt string).
  Typecheck + prod build clean. **Headless integration check** (scratch): real
  PlaybackEngine + FillEngine + real `computeConfirmation` over synthetic bars stamped live-computed
  flags onto an actual trade (htfTrend up / withHtfTrend true for a long in an uptrend; tag carried).
  *Interactive ticket click-through is a hand-check (repo convention for UX slices).*

### #9 outcome (2026-07-12) — multi-timeframe live-forming, verified — commit `8a33766`
ADR-0002 amendment. Issue closed.
The engine work landed early: since **#2**, `PlaybackEngine.step()` folds every 1s bar through all
three `TimeframeAggregator`s (1m/5m/15m) each tick, retaining per-TF sealed `history` + the live
`forming` candle, and `main.ts` `switchTimeframe()` already lets the trader flip timeframe in any
phase (prep folds `prepBars`, attempt reads `historyOf(tf)`+`formingOf(tf)`, review reads
`reviewHistory`). So #9 was **not** new code — it was **closing the acceptance criteria with tests
that exercise the real UI code paths** (the folding was previously only covered by an isolated-fold
and a speed-determinism test, neither of which proves the live multi-TF output is *correct*):
- **Criterion 3 (HTF == reference):** new test steps the engine second-by-second over a synthetic
  1000s day and, at **every** second, deep-equals `[...historyOf(tf), formingOf(tf)]` against
  `foldDay(barsProcessedSoFar, tf)` (the independent reference that re-buckets from scratch) for all
  three timeframes. Proves the live fold is exactly the reference — no drift, no off-by-one seal.
- **Criterion 2 (switch preserves the forward-only wall):** new test stops mid-attempt (second 733,
  mid-bucket on every tf), reconstructs exactly what `switchTimeframe()` would draw, and asserts (a)
  no candle opens on/after the bucket the clock is still filling, (b) it equals `foldDay(seen, tf)`,
  and (c) it is **strictly shorter** than the full-day fold — future buckets are withheld, ADR-0002.
- **Semantic roles** (issue): 5m is the confirmation timeframe (feeds #10), 15m carries the Opening
  Range (feeds #16) — both are now first-class live folds available to those downstream slices.
- **Tests**: TS `npm test` → 42 (+2 aggregator: reference-match, mid-attempt wall). Typecheck + prod
  build clean. **No product source changed** (test-only), so no runtime behavior to hand-verify.

### Post-#8 UX polish (2026-07-12, hand-test feedback) — commit `04d5220`
Frontend-only tweaks from driving the app; no engine/logic change:
- **Chart time is always ET** (DST-proof, browser-locale-independent): `chartView` sets
  `timeScale.tickMarkFormatter` + `localization.timeFormatter` to format the ET-as-UTC epoch's UTC
  components (= the ET wall clock). Toolbar clock labelled "clock (ET)".
- **Prep marking toolbar moved to the top** of the chart (was over the time axis). **＋ Level is
  click-to-place** (`LevelMarker.beginPlaceLine`): a dashed ghost follows the cursor, click to drop
  (Esc / re-click cancels; toolbar clicks never register as placements). ▭ Range still drags a band.
- **Trade draw** gained a **Draw-style toggle** (`main.ts` `drawMode`): **Click** = click to set the
  entry then drag stop/target bars (`BracketEditor.startClickPlace`, new `place-entry` mode);
  **Drag** = the old seed-all-three (`start`). **Market** fixes the entry at last and greys the
  toggle (`startMarket`). An explicit **Order type** selector (Market/Limit/Stop) replaces the old
  geometry inference; **Arm** is hidden until an entry is set.

### ⚠ Dev gotchas learned this session (read before running the app)
- **`app/vite.config.ts` is load-bearing.** Without it Vite full-reloads the webview at startup
  (dep pre-bundle), and that reload races Tauri's `__TAURI_INTERNALS__` injection → `isTauri()`
  flips **false** → the app silently falls back to browser-dev mode (gated feed + prep bars stop
  loading, chart goes blank). The config pins `optimizeDeps.include` + `strictPort` to stop it.
- **Editing frontend files while `tauri dev` runs triggers an HMR reload that can also drop Tauri
  mode.** After code changes, do a **fresh `npx tauri dev`** rather than trusting the hot-reload.
- Run the app: `cd app && npx tauri dev` (needs `~/.cargo/bin` on PATH). The gated feed + prep
  bars only work under Tauri; a plain browser (`npm run dev`) degrades (no prep chart).
- **`data/sessions/` is gitignored** — every dev/test boot writes a throwaway attempt log
  (`session_started` + whatever you do). Records are still the tracked source of truth *by design*
  (decision 12): force-add a curated real one with `git add -f data/sessions/<date>/<symbol>-N.ndjson`.

### #8 outcome (2026-07-11) — grade: report card + AI coaching (ADR-0003, SPEC §5)
The last slice to a first graded trade. Two buckets that never mix:
- **Objective report card** (portable TS, `app/src/grade/`): `reportCard.ts` scores the blind
  level-marking drill — per true level, nearest-mark **precision** credit (full inside a per-symbol
  tolerance, linear decay to zero) folded with **coverage**; plus a deterministic **bias classifier**
  over the sealed 2h window (`classifyStructure`: directional when |net|/range ≥ a threshold, else
  chop) graded against the committed call. Tolerances/thresholds are per-symbol open params in
  `types.ts` (`GRADE_CONFIGS`, NQ tuned first). Volume-zone accuracy stays deferred (#14).
- **AI synthesis** (`grade.ts`): `buildDigest` (`digest.ts`) makes a **compact** digest — prep +
  journal verbatim, day structure, the trade tape (entry proximity to marks, bias alignment, R,
  MAE/MFE), and the **already-computed** report-card numbers — then `buildGradeRequest` builds one
  Anthropic Messages call (**structured output**, three-axis JSON: plan adherence / execution /
  outcome + notes + summary). `parseAiGrade` reads it back. The prompt tells the model to *reference*
  the objective numbers, **not recompute** them (verified live: it echoed "coverage 0.75,
  precision 1.0").
- **Key stays server-side**: new Rust command **`grade_via_anthropic`** (`lib.rs`) reads
  `ANTHROPIC_API_KEY` from the process env or the gitignored repo `.env`, injects the header, and
  forwards the frontend-built body (mirrors how ingestion isolates the Databento key). Added
  `reqwest` (rustls). The webview never sees the key.
- **Seal + UI**: `grade_computed` event added to the vocabulary (carries `reportCard` + nullable
  `aiGrade`); `fold` now also reconstructs `prep` (needed to score the marks) and `grade`.
  `recorder.commitGrade`. In Review a **Grade panel** (`index.html` + `main.ts`) takes a minimal
  journal note, computes the report card, calls the AI under Tauri (browser dev degrades to
  report-card-only), seals `grade_computed`, and renders the card + three-axis coaching.
- **Models**: default `claude-sonnet-5` (Sonnet coaching), `claude-opus-4-8` reserved for the deeper
  end-of-module pass (constants in `grade.ts`), per the `claude-api` skill.
- **Tests**: TS `npm test` → 40 (+11 grade: credit decay, coverage/precision, bias classify, digest
  proximity/alignment, request-shape, parse+clamp, fold). Also **fixed a pre-existing broken session
  test** (the key-order-independence check dropped `markedZones`, so it had been failing on the clean
  tree). Rust → 6 (unchanged; the command is a thin passthrough). Typecheck + prod build clean, Rust
  builds clean. **Live-verified**: real `claude-sonnet-5` call returned valid three-axis JSON, parsed
  and rendered. *Interactive Grade-panel click-through is a hand-check (repo convention for UX slices).*

### #8 build plan — DONE (kept for the design rationale) — ADR-0003, SPEC §5, issue #8
Two buckets. **(1) Prep report card — objective, engine-computed** (portable TS, likely a new
`app/src/grade/` folding the session event log + the levels answer key):
- **Level-marking accuracy** via the hidden-drill: fold `prep_committed` → the trader's
  `markedLevels`; load the true levels (`load_levels`). Score **coverage** (did they mark each
  in-scope level — the toggle set is `PDH/PDL/ONH/ONL` today) + **precision** (distance per mark,
  full credit within a few pts, graceful decay; **per-symbol tolerance is an open param**).
- **Bias call** (bull/bear/chop) vs the realized session — needs a **deterministic bias
  classifier over the 2h traded window** (thresholds are an **open param**, ADR-0003).
- Volume-zone accuracy is **deferred** (ships with the profiles module, #14) — not slice-0.
**(2) AI synthesis (hard + soft)**: build a **hard digest** (trades, R, MAE/MFE, entry proximity
to marked levels, consistency with the called bias) + soft inputs (prose bias, journal) → one
**Anthropic call** that narrates adherence/execution/outcome and coaches (it does NOT compute the
objective numbers). Then append a **`grade_computed`** event (already in the event vocabulary) and
show a report-card panel in Review.

Prerequisites / decisions for #8 (all now resolved):
- **`ANTHROPIC_API_KEY`** is in the gitignored `.env` and read by the Rust command (never in chat).
- **Where the API call lives:** server-side `grade_via_anthropic` Rust command reads the key and
  forwards the frontend-built body — done (see outcome above).
- **Model IDs:** `claude-sonnet-5` default, `claude-opus-4-8` for deep coaching — done.
- The Journal is still a minimal single field (open param, ADR-0003); structured prompts are later.

### Deferred UX the user asked for (2026-07-11) — issue #16
The user's real prep process reads **daily/hourly over ~a week** for trend; #7's prep is minimal
(1m/5m/15m over prior-day + overnight only). Higher-timeframe context is **issue #16 (HTF context
charts + trend read: 30m/1h/4h + up/down/range trend)**. Daily + a week of history folds in there.

### #7 level source — RESOLVED (Option C, 2026-07-10)
The "true" pre-session levels the hidden-level drill reveals are now computed by ingestion and
committed as a tracked answer key. `ingestion/fetch_day.py` (+`--no-levels`) folds cheap
`ohlcv-1m` history into **`data/levels/{symbol}-{date}.json`** (minimal real set: `PDH`/`PDL` =
prior RTH day 09:30–16:00; `ONH`/`ONL` = overnight Globex `[prior 18:00, 09:30)`). NQ 2024-08-05
answer key is committed (PDH 18761 / PDL 18385.75 / ONH 18390 / ONL 17351; ~$0.017). PW/PM H/L,
prior VAs, and the Asia/London split (ET windows TBD) extend the same file later.

### #7 outcome (2026-07-10) — Prep gate (ADR-0003)
Prep-UX per the user: mark on the **prior-day chart** (the eval is practising the marking ritual,
not hiding levels), so the drill is coverage/proximity, not a blind precision test.
- **Data layer** (`6972bc3`): ingestion persists prior-RTH-day + overnight 1m bars (gitignored
  `..._presession-1m.parquet`); Rust `load_presession` (ungated context) + `load_levels` (answer
  key). The true-level source is Option C (`data/levels/{symbol}-{date}.json`).
- **Prep model** (`session/events.ts`): `Prep { markedLevels, biasProse, biasCall }` replaces the
  #5 `PrepStub`; `prep_committed` carries it, hashed. `recorder.commitPrep(Prep)`.
- **Marking tool** (`prep/levelMarker.ts`): draggable **level lines** AND **range/zone** marks
  (low/high edges + shaded band), via a **floating toolbar over the chart** (＋ Level / ▭ Range /
  Clear). `ChartView.setLevelLines` draws the revealed true levels as persistent native price
  lines. Prep carries `markedLevels` + `markedZones` (zones AI-graded, not precision-scored).
- **UX revision (2026-07-10, post-hand-test)**: fixed a blank prep chart — the prior-day candles
  now render only once the chart container has a non-zero size (Vite injects CSS via JS, so at
  init the container could measure 0×0 and setData parked the view on empty space). Marking moved
  off the cramped sidebar into the floating toolbar; the manual **order-entry form was removed**
  (trading is chart-first: draw the bracket) — kept side/size/draw/arm/cancel/flatten; sidebar
  widened 260→320px with more gap.
- **Phase machine** (`main.ts`): `phase: "prep" | "attempt" | "review"` (subsumes the old
  `reviewing` flag). On load → **prep**: show the `load_presession` chart (dev degrades to empty),
  lock transport + trading. Prep panel = marks list + prose bias + bull/bear/chop + Commit.
  **Commit** → real `prep_committed` (immutable seal; #5 auto-stub removed) → `load_levels` reveals
  the true levels + a nearest-mark proximity readout → transition to **attempt** (swap to the live
  RTH feed, unlock trading). A second commit is impossible (guarded + marker destroyed).
- **Post-hand-test polish (2026-07-11, user-confirmed working)**: (a) the blank-chart root cause
  was the missing `vite.config.ts` (see Dev gotchas above), not rendering — LWC held all 1380
  candles fine. (b) On commit the attempt now shows **both** the true levels (yellow, descriptive
  labels "Overnight high" etc.) **and the trader's own marks** (levels blue-dashed, zone edges
  purple-dashed) via `ChartView.setLevelLines` (now per-line color + dashed). (c) The reveal panel
  uses descriptive level names. (d) Added a "press ▶ Play to start" hint (the attempt chart is
  empty until playback runs). *Note for this crash day: the true levels (18385–18761) sit far
  above the ~17561 open, so their lines are off the top of the RTH view until you zoom out; the
  reveal panel lists all prices.*
- **Tests**: TS `npm test` → 29 (session tests updated to the real `Prep`); Rust → 6. Typecheck +
  build clean; hand-verified end-to-end in the running app.

### #6 outcome (2026-07-10) — annotated Review scrub (ADR-0002 unlock)
- **The unlock is server-enforced** (`lib.rs`): `Feed.review_unlocked` (re-armed on every
  `set_day`); `unlock_review` drops the wall; **`review_bars`** hands over the full day only once
  unlocked, else `Err` — so the frontend still cannot obtain future price mid-attempt (ADR-0002).
  Rust test `review_bars_are_walled_until_unlocked`.
- **Feed** (`barFeed.ts`): `unlockReview()` / `reviewBars()` on the `BarFeed` interface (Tauri
  invokes; dev returns its in-memory day). **`app/src/review/review.ts` `foldDay(bars, tf)`** folds
  a whole day into the complete candle series (all sealed + final forming) — 3 unit tests.
- **Review mode** (`main.ts`): entered on 11:30 `onEnd` or the new **⏹ End & Review** button (a
  one-way concession — flatten flat, seal, unlock; you can't peek then resume). `enterReview()`
  pauses the clock, folds the full day into all timeframes, `setData`s every candle (native chart
  pan = **bidirectional scrub over the full 2h**), keeps entry/exit/stop markers, and locks
  trading (`syncControls`/submit/F-key/transport all gated by `reviewing`). Trades panel now
  annotates **MAE/MFE** per row. Title shows `· REVIEW`.
- **Tests**: TS `npm test` → 29 (+3 review-fold); Rust `cargo test --lib` → 5 (+review wall).
  Typecheck + prod build clean. App boots clean on the new build. *Interactive scrub/annotation
  is a hand-check (repo convention for UX slices).*

### #5 outcome (2026-07-10) — seal the attempt (ADR-0005)
- **Session module** (`app/src/session/`, portable TS): `events.ts` = the typed `SessionEvent`
  vocabulary (`session_started`, `prep_committed`, `order_placed`, `order_cancelled`, `fill`,
  `stop_moved`, `flatten`, `trade_closed`, `end_of_day`) + envelope (`seq`, `t` sim-second, `at`
  wall clock), the **`fold(events) → SessionState`** read path, and `hashPrep` (canonical-JSON +
  cyrb53; #7 can swap SHA-256). `recorder.ts` = `SessionRecorder` mapping the engine's moments to
  events with an **order-serialised** async NDJSON sink; `startTauriSession` (Tauri) vs
  `memorySink` (dev/tests).
- **Fill engine emit points** (`fillEngine.ts`): added `onEvent(FillEvent)` emitting at
  `place`/`cancelPending`/entry-fill/exit-fill/`close`. **`stop_moved` is coalesced per bar** —
  a live drag fires `modifyBracket` continuously, so the engine logs only the effective stop that
  guarded each second (at the bar it took effect). `FillReason` gained `"end-of-day"`;
  `flatten(bar, reason)` carries the cause.
- **First repo write path** (`lib.rs`): `start_session` allocates the next attempt via
  `next_attempt` (one past the highest `{symbol}-{n}.ndjson`, `create_new` so a re-practice is a
  **distinct** log, never a clobber) and `append_event` appends one line. Records live at tracked
  `data/sessions/{date}/{symbol}-{attempt}.ndjson` (NOT gitignored). No-peek wall unchanged —
  still Rust-gated (ADR-0002); `reset_feed` stays a dev-only affordance, never called in the app.
- **Auto-flatten at 11:30**: playback `onEnd` now cancels working orders, `flatten(lastBar,
  "end-of-day")` any open position, and seals with an `end_of_day` event. Title shows `· attempt N`.
- **Tests**: TS `npm test` → 26 (+6 session: fold-is-truth, full event order, drag coalescing,
  eod flatten, cancel, prep-hash stability/tamper). Rust `cargo test --lib` → 4 (+attempt
  increment). Typecheck + prod build clean. **Verified live**: real Tauri app booted → wrote
  `data/sessions/2024-08-05/NQ-1.ndjson` with `session_started` + hashed `prep_committed`
  (throwaway record removed).

### #4 outcome (2026-07-10) — true tick-resolution of straddles (ADR-0004)
- **Ingestion**: `fetch_day.py` now also pulls the day's raw `trades` for 09:30–11:30 →
  gitignored `data/bars/NQ/2024-08-05_trades.parquet` (203,374 prints, $0.25). Columns `t`
  (canonical second, matches bars), `ts` (true UTC ns for ordering), `price`. `--no-ticks` to
  skip. All 7,188 bar-seconds have ticks.
- **Rust** (`bars.rs`/`lib.rs`): `load_ticks` builds `second → ordered prices`; `load_day` loads
  it (boot log: `7188 bars, 7188 tick-seconds`); command **`ticks_for_second(t)`** serves one
  reached second (not a peek). Missing cache → empty → pessimistic fallback.
- **Fill engine** (`fillEngine.ts`): `onBar` is now async; a straddle calls the injected
  `StraddleResolver`, walks the prints in order (`firstTouch`), and fills whichever level price
  reached first, flagged `exitMethod: "tick-true"`; no ticks → `"pessimistic"`. `main.ts` wires
  the resolver to `ticks_for_second` under Tauri (browser dev → pessimistic). `PlaybackEngine`
  now awaits the tick subscriber so resolution completes in clock order.
- **Determinism**: tick cache is fixed + ts-ordered → same day replays identically.
- **Tests**: TS `npm test` → 19 (added 3 tick-resolution: target-first, stop-first, fallback);
  Rust `cargo test --lib` → 3 (added tick-cache load-in-order). Typecheck + prod build clean.

### Polish (2026-07-10)
- Price scale is **pinned while drawing a bracket** (`ChartView.setPriceAutoScale`,
  toggled in `BracketEditor.start/cancel`) — kills the line-jitter noticed at 30×.

### Trade management (2026-07-10) — post-#3 UX (confirmed by hand)
- **Manage a live position on the chart**: `BracketEditor` now has a `manage` mode (entry fixed,
  stop/target draggable) that attaches when a position opens; dragging calls
  `FillEngine.modifyBracket({stop,target})` live (OCO, effective next bar). **R stays anchored to
  the initial stop** even after trailing (`initialStop` never rewritten — CONTEXT; unit-tested).
- **Cancel a resting order**: `cancelOrder` button appears for an unfilled working order →
  `FillEngine.cancelPending()`. **Flatten** relabelled "Flatten (F)" + **F key** market-exits.
- `main.ts` `syncControls()` is the single state machine reconciling buttons + overlay vs
  engine state (flat / working order / live position / placement draw).
- *Known cosmetic (user chose to leave it)*: fill markers are bar-relative (LWC has no exact-
  price marker), so a fill dot drifts slightly while its 1m candle is still forming, then locks.
  The trade record's exit price/second are exact regardless. Optional future fix: overlay dots at
  `priceToY(fillPrice)`.

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
  flag, totals), chart bracket price-lines + fill markers.
- **On-chart bracket editor** (`app/src/trading/bracketEditor.ts`): TradingView-style draggable
  entry/stop/target lines as an HTML overlay on the chart (Lightweight Charts has no native order
  tool). Only the lines capture the mouse so the chart stays pannable; live R:R; entry type
  auto-inferred from entry-vs-price (above=stop/breakout, below=limit/pullback, at=market).
  "Draw on chart" → drag → "Arm bracket". Confirmed working by hand.
  - *Known minor*: lines visually jump as the price axis autoscales while candles print
    (amplified at 30×) — cosmetic; optional fix is to pin the price scale during a draft.

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
- AI models: default `claude-sonnet-5`, `claude-opus-4-8` for deep end-of-module coaching (SPEC §5,
  wired in `app/src/grade/grade.ts`). Per-symbol grade tolerances/bias thresholds live in
  `app/src/grade/types.ts` (`GRADE_CONFIGS`) — NQ tuned first, others mirror it until hand-calibrated.

## Deferred by design (post-core, in order)
Calendar/module/progression (#17) → volume-profile histogram polish (#14) → micro↔mini (#19).
Base-rate stats (#18) computed **as-of the practiced day, no lookahead** (ADR-0008).
