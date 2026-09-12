# Project state — read this first

Local, single-user **ORB/IB practice simulator**: replay the first 2h of the NY index-futures
open (NQ/ES), commit a plan, trade forward-only with honest fills, then get AI coaching graded on
**process, not outcome**. Status: **core loop complete (through #8) + enrichment slices #9–#12
shipped; #13 code-done pending a data pull** (see its entry — run
`.venv/Scripts/python.exe ingestion/fetch_day.py --no-ticks --force-levels` to populate the real
numbers). The full loop runs end-to-end (Prep → attempt → Review → grade) and a Trade is now a
full scaled position lifecycle (scale in/out via ordinary orders, #11). The chart now auto-draws
the intraday objective levels — Opening Range, developing IB, NY-open VWAP (#12). **Level-marking
is a Prep discipline ritual, NOT scored** (the precision/coverage score was removed 2026-07-13 —
see the entry below; this supersedes ADR-0003/decision-8's "precision-scored levels").

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
Issues **#1–#12 DONE** (#12 no-cost half; see fork note) + on-chart trade management. The full loop
runs — **Prep gate** (#7) → **attempt** (#5) → **Review** (#6) → **grade** (#8). Everything past
here is enrichment, not the spine. **Unblocked now**:
- **#16 HTF context charts + trend read (30m/1h/4h)** — now unblocked by #9; folds in daily + a
  week of history (the user's real prep process, deferred from #7).
- **#17 Calendar + module/progression tracking** — sits directly on the sealed event logs (#8).
- **#18 Base-rate stats, as-of the practiced day** — no-lookahead stats (ADR-0008), on #1 + #8.
- **#19 Micro↔mini multiplier toggle** — the contract-size switch (#3; `CONTRACTS` already has
  MNQ/MES).
**Profiles chain: #13 code-done** (pending the pull above) → **#14** (live volume-profile histogram
+ auto HVN/value-area — the intraday counterpart of #13's static prior-period VAs) → **#15**
(discretionary S/D zone + HVN drawing tools). #14/#15 are unblocked once #13's data lands. The
`ingestion/levels.py` `value_area`/`volume_profile` helpers are reusable for #14's live profile.

### ⚠ The $80 risk budget is DEAD (2026-08-30) — stop is set by the market, account by the stop
User call ("lets nuke this idea of $80, risk of $200-300 a trade"), now confirmed by measurement
on real data. **The $80 came from `drawdown / 25` on a $2,000 account — a formula output that was
never tested against a strategy.** Measured on NQ's 9:45 opening-range break (upside only, 2x
target, flat 12:30, `analysis/study_nq_breakdown.py` over 529 real trades):

| Risk/trade | $/trade | Win rate |
|---|---|---|
| $80  | +$2.77  | 37.4% |
| $150 | +$14.41 | 49.0% |
| **$200** | **+$16.10** | **52.7%** |
| $250 | +$11.73 | 53.1% |
| $300 | +$12.77 | 53.9% |

An $80 stop sits **inside the noise** — the study's own damage-before-the-move figures (median
$70, 3-in-4 $137, 9-in-10 $228) say it gets hit before the move on trades that were going to win.
It satisfies the ruin formula by destroying the edge the formula exists to protect.
- **The correct direction of reasoning: set the stop from what the instrument needs, then choose
  an ACCOUNT SIZE that can hold it.** Never solve for the stop by dividing the drawdown you
  happen to own. `N_R ≥ 25` is a property of the (stop, account) pair, and it was calibrated for
  500–1000 trades — a rule firing ~106×/year needs far less, so bootstrap the real distribution
  (`analysis/study_nq_survival.py`) instead of obeying the thumb.
- **Survival at a $200 stop, 1 MNQ, one year** (20k bootstrapped years, Lucid EOD trailing DD):
  **25k 44% · 50k 73% · 100k 93% · 150k 99%**. Across the user's whole $200–300 range **$200
  wins on BOTH expectancy and survival**, so there is no trade-off to make inside it.
- **Profit is ~$2,100–2,800 per surviving account-year at 1 MNQ regardless of account size**
  (bigger accounts show slightly less only because small ones survive solely when they run hot —
  survivorship, not a real difference). **Account size buys survival, not income; income comes
  from more ACCOUNTS, not more contracts.**
- **⚠ Annualisation bug (caught by the user, same day).** The first pass divided trade counts by
  `dt.year.nunique()`; the sample spans **four years across FIVE calendar-year labels** (Aug 2022 –
  Aug 2026, first and last partial), so every annual figure came out ~25% low. Fixed to use
  elapsed span in `study_nq_survival.py` and `study_nq_scale.py`. Figures here are corrected.
- **Trade BOTH sides — optimise $/YEAR, not $/trade.** This rule fires at most once a morning, so
  **253 trades/yr is its structural ceiling** (both sides); upside-only halves it to 132.
  Upside-only is the better trade ($16.43 at 1.5x) but the worse year ($2,143 vs **$3,029**).
  Best cell inside the user's risk range: **$200 stop, 1.5x target, both sides** — $11.98/trade,
  t = 2.02. More trades must come from other SETUPS or SESSIONS, never from tuning this rule.
- **Scaling ceiling (`analysis/study_nq_scale.py`):** Lucid caps a trader at **5 funded accounts**
  ($750k combined, 10 incl. evals). Best per-account expectation after bust-and-replace costs is a
  150k at 2 MNQ = **$4,817/yr (63.5% survive)** or 4 MNQ = $6,268/yr (37.8% survive). **Lucid alone
  therefore tops out at ~$24–31k/year.** A ~$100k goal needs ~16–21 simultaneous accounts, i.e.
  multiple prop firms and/or a second uncorrelated setup. NQ+ES would NOT be diversification
  (~95% correlated = double size on one bet); separate SESSIONS would be.
- **Changed:** `tradingview/permission-lamp.pine` risk-budget default **80 → 200**, tooltip and
  section comment rewritten to teach the corrected direction of reasoning. The entry below is
  superseded wherever it says $80 or `drawdown/25`.

### Position sizing + stop-budget veto (2026-08-22) — live-chart + prop economics, no sim change
Worked the sizing question from first principles (prompted by a YouTube transcript, `quantguy.md`,
untracked). Verified its claims by Monte Carlo: the losing-streak table and the
`t = Sharpe x sqrt(years)` result are correct; its "97% chance of blowing a $2k account at $500
risk" overstates ~2x (the honest number is ~48% — it conflates "a 4-loss run occurs" with "you were
at the starting balance when it did"). Everything reduces to **N_R = account drawdown / risk per
trade**: ruin ~ exp(-2*m*N_R/v) for per-trade expectancy m and variance v in R, so **halving size
squares the ruin probability**. Expected worst drawdown over 500-1000 trades is 15-20R, so the
survival target is **N_R >= 25**. One NQ/GC **mini** on a $2k drawdown is N_R = 3.3 —
unsurvivable at any skill level; micros are structural, not preference.
- **Lucid Pro 50k rules** (user-confirmed): eval $115 one-time, **no monthly fee**, +$3k target,
  $2k max loss, **EOD trailing** DD locking at the $50k start once peak EOD hits $52k, $1.2k DLL,
  no consistency, **no minimum days**. Funded: same, DLL = $1.2k below the initial trail then
  **60% of (peak EOD - $50k)** above it (continuous at the lock point — and a trap: at a $56k peak
  it permits a $3.6k daily loss against $6k of room). **40% consistency** (total >= 2.5x best day,
  which is why the 3-day minimum is redundant). $500 min payout, no cap.
- **The finding — eval and funded want OPPOSITE sizes**, because the cost of failure is asymmetric:
  an eval bust costs $115, a funded bust costs the income stream. Eval is a **funding operation**:
  4-5 MNQ / 40pt max stop, ~60%/50% pass, ~2 weeks, ~$950-1,150 all-in for 5 copy-traded accounts.
  The **zero-edge floor is P(pass) = 2000/5000 = 40%**, so the blitz does not depend on the Tokyo
  playbook being proven. The whole span from 4 months (1 MNQ) to 2 days (15 MNQ) costs only ~$733.
  Funded: **1 MNQ / $200 risk** (corrected 2026-08-30 — see the entry below; the earlier "$80"
  was drawdown/25, a formula output that measurement shows destroys the edge); build ~$2k cushion
  before the $500 payout (lifetime payout scales with cushion **squared**, size only linearly).
- **Expectancy is the only lever that improves BOTH clocks** (ruin and time-to-target); size trades
  one against the other. 40%@2R = 0.20R/trade, 35%@3R = 0.40R/trade. Decision rule, measurable from
  fills: **hold for 3R iff >75% of the trades that reach 2R also reach 3R** (2R earns 3*P2-1, 3R
  earns 4*P3-1; break-even at P3 = 0.75*P2).
- **`tradingview/permission-lamp.pine` gained a Stop budget group** — the **size veto**, settling the
  fixed-dollar-risk sizing left in Flagged ambiguities 2026-08-11. Inputs: risk budget ($, default
  80), contracts, swing lookback, show-band. Derives max stop distance from `syminfo.pointvalue`
  (instrument-agnostic: 40pt MNQ / $8.00 MGC at $80), draws a dashed **budget band** around price,
  and adds a table row comparing it to the nearest swing on the **lamp's own permitted side**
  (long -> swing low, short -> swing high). The anchor read is an explicit pivot APPROXIMATION of the
  sweep extreme — the band is the truth, the row is a hint; the liquidity map draws the real
  extremes. Table grew 13 -> 14 rows. **User-confirmed compiling + rendering in TV 2026-08-22.**
  The band is a **ceiling only** — it never says where a stop belongs (that stays structural, beyond
  the sweep extreme). Do not widen a stop to fill the budget.
- **Study pages**: **`docs/study/position-sizing.html`** (N_R, the ruin/max-drawdown tables, the two
  clocks, the eval/funded split, the Lucid rules and where they bite, six short rules) +
  **`docs/study/footprint.html`** (the footprint read as rendered **ladders** — absorption, the
  trapped-buyer delta flip, thin tops, stacked-imbalance initiative — since a footprint is a shape
  and `cvd-and-rsi.md` only had the words; that file keeps the CVD history + the RSI half).
- **Chart de-clutter** (user runs ORB + RSI + peachy + lamp + liquidity-map + volume): Peachy's
  **regime table is a duplicate** of the lamp's Ambition row (same 1h/4h 50-vs-200 verdict) -> off;
  **RSI off** (the 2026-07-30 call is chop-days-only, not being followed); **volume off once
  footprint is on**. Keep ORB, liquidity-map, lamp, Peachy's EMA cloud, footprint.
- **Open / deferred**: an **ATR noise floor** to turn the band into a corridor (too-tight as well as
  too-wide, and an "untradeable at this size" veto when the floor exceeds the ceiling) — multiplier
  is the open param, ~1.2x ATR proposed, NOT built. `analysis/sizing.py` (the simulators, plus
  estimating real w/b and the 75% runner test from `data/sessions/*.ndjson`) deferred by user until
  there are enough funded fills to measure. **All figures above assume 40%@2R — unmeasured.**

### Permission lamp (2026-08-14) — grill session; design + docs only, NO pine written yet
Resolved: the playbook's deterministic rules become a **Permission lamp** (CONTEXT.md entry) —
a vetoes-only on-chart display of regime state + per-setup legality; never "enter", never
"conditions met" (**ADR-0011**). State space: side ∈ {long-only, short-only, chop, **stand-by**
(price/VWAP-slope disagreement — nothing legal)} from session-VWAP side+slope; ambition ∈
{press, harvest} by the **unanimity rule** (press iff session side + 1h + 4h SMA regimes all
agree). Legality = **direction lock × family lock** (CONTEXT.md "Setup families": continuation
family banned in chop; fade family legal both ways in chop; stand-by bans all; ambition never
changes legality). Two-strike counter = the one hand-set input, quarantined (marked hand-set,
labeled override, new-session carried-over tripwire). Failed-auction flip out of scope (targets
≠ permissions); level vetoes (third-test/Coil) stay on the liquidity map. Surface: **one
instrument-agnostic `tradingview/permission-lamp.pine`** (session-VWAP-anchor input 09:30 /
08:20 / 18:00) — WRITTEN; compiles + renders in TV (user-confirmed 2026-08-14); state reads
not yet hand-verified against a live session. Study pages: **`docs/study/permission-lamp.html`**
(what the lamp refuses to do, four side states, unanimity table, full 4×6 legality matrix,
strikes quarantine, lamp/map/trader division) + **`docs/study/liquidity-map.html`** (stops-as-
fuel core idea, EQH/EQL touch-count "countdown" read, swept-vs-broken, bounce gradient, gap
boxes, pattern→primitive translation table, known limitations) — both self-contained HTML/CSS,
no JS, light+dark. Phase 2 (deferred): same machine as portable TS in the sim
over the replay clock (strikes computed from real stop-outs), Review annotated with lamp state
per entry; a "conditions met" channel is legal ONLY there (sim/Review), never on the live
chart. New open params: VWAP flat-slope threshold (chop vs trending) + slope lookback.

### Patterns-as-liquidity + liquidity-map indicator (2026-08-12) — grill session; live-chart + playbook, no sim change
Resolved: classical chart patterns are **liquidity maps only, never entry signals**. CONTEXT.md
gained **Equal extremes** (double/triple tops-bottoms = growing stop pools; sweep is the event),
**Two-sided run** (steamroller wicks; stand down / structural stops only), **Head & shoulders**
(the head IS the sweep; right-shoulder stop pocket = next fuel), **Gap** (trapped crowd +
prior-close magnet; gap-and-go vs fill read), a pin-bar line under Liquidity sweep, and coil
aliases (triangles/pennants/flags/wedges). Full plain-words catalog:
**`docs/study/patterns-as-liquidity.md`**. New **`tradingview/liquidity-map.pine`**
(instrument-agnostic third indicator): pivot-based equal-extremes tracer (lines persist until
swept/broken, touch-count labels feed the third-test rule, sweep markers) + RTH gap boxes until
filled. Named-pattern auto-detection deliberately skipped (subjective, fires late). *Pine
untested locally — paste into TV and report back.*
**Same-day chart autopsy** (user's 2026-08-12 MNQ screenshot — long-biased W/H&S reads on a
short day): adopted the **Auction bias gate** (session VWAP side+slope picks the side; HTF SMA
regime picks *ambition* — press when aligned, harvest at reduced size in conflict; a failed
auction at the open flips the target map), the **A+ lesson** (a first sweep in an unresolved
auction is never A+), **three stop policies** (tight sweep-extreme w/ re-entry duty, structural
day-thesis, conditional 5m-close exit + disaster stop; the tight+no-re-entry+conviction hybrid
is banned), and the **Equal-extremes trend fix** (pools in the auction's path get ridden
through, not defended). SMA/EMA indicator params deliberately unchanged — precedence problem,
not parameters.

### Indicator split + smart-money entry rules (2026-08-11) — grill session; live-chart + playbook, no sim change
**Playbook** (user kept being right but swept out early): CONTEXT.md gained **Coil** / **Coil
rule**, **Erosion**, four **Entry gates**, and the **Stop anchor** rule; fixed-dollar-risk sizing
proposed but not adopted (Flagged ambiguities). **Indicator** (ADR-0010): combined pine deleted,
split into `tradingview/orb-index.pine` (NY 15m+30m ORBs, IB unchanged, 09:30 VWAP) and
`tradingview/orb-gold.pine` (NY 08:20 15m ORB, Asia 18:00 5m ORB, 08:20 VWAP); ORBs have
toggleable H/L/midpoint + optional shade, **windowed** extent (no more full-width lines);
London ORB dropped (ORB only for a session traded at its open); homemade VRVP dropped (native
TV Premium profile); AVWAP = TV's built-in drawing tool. CONTEXT.md Opening Range + Trading
window updated (gold is live-chart-only). *Pine untested locally — paste into TV and report back.*

### Bookmap evaluation → TV Premium footprint adoption (2026-08-06) — live-chart tooling, no sim change
Grill session outcome (evaluated Bookmap's liquidity heatmap): **(1) Upgrade TradingView
Essential → Premium (~$59/mo) for native Volume Footprint charts** — the footprint replaces
the CVD pane as the every-day absorption/initiative read at levels (per-price sell×buy rows
+ per-bar delta, real ticks; reads the failed-auction-vs-breakout question directly).
**(2) CVD pane verdict after live use: redundant by construction** on Essential — the 1m
close-vs-open classification is candle color restated, so the line couldn't disagree with
the chart. A rendering failure, not a delta-concept failure; `tradingview/cvd.pine` is
**retired** (kept in repo, off the chart). The old "Premium if the read changes decisions"
gate is moot — footprint supersedes the pane entirely. **(3) Skip the Lucid/Tradovate CME
L2 "Market Depth Full Bundle" ($48/mo)** — it only lights up TV's snapshot DOM ladder (no
history trail, no Pine/footprint access): depth-data money without the tool that makes
depth legible. **(4) Bookmap deferred** (Global $49 + CME depth $34 = ~$83/mo, second app
outside the Lucid-in-TV execution loop). Its unique value over the footprint is the
**passive-wall trail** (walls persisting / pulling / reloading *before* price arrives —
spoofable, its own read to learn); stops are invisible to any book, so it can't find the
magnets — the levels already do that. Reconsider only if a future **sim heatmap slice**
(Databento MBP-10 depth for the practiced day + a canvas heatmap layer in replay — a real
slice, LWC has no heatmap primitive) proves that read changes decisions. Docs:
`docs/study/cvd-and-rsi.md` rewritten footprint-first (absorption/initiative language
carried over; chop-day RSI playbook unchanged); CONTEXT.md gained a **Footprint** entry and
the CVD entry is marked superseded.

### TradingView CVD pane + RSI demotion (2026-07-30) — live-chart companion, no sim change
Grill session outcome: **CVD (cumulative volume delta) replaces RSI as the every-day
exhaustion/absorption read at levels; RSI is demoted to a chop-day-only fade gauge** (it pins
overbought on trend days — miscalibrated for the best ORB days — and is price-derived, so
redundant with the EMA cloud). New **`tradingview/cvd.pine`** (Pine v6, standalone pane):
signed intrabar volume via `request.security_lower_tf` (close-vs-open classification, carry
direction on doji), session-anchored reset (**input**: RTH 09:30 default / Globex 18:00, via
the `time(tf, session, tz)` na-transition idiom), **style input** line (default) / delta
candles (o/h/l/c folded from the intrabar walk), zero line, reset-bar shade, degenerate-TF
warning table. Visual-only by design — no divergence detection/alerts in v1 (learn the raw
read first). **Fidelity caveat**: user is on TV Essential → 1-minute intrabar floor; read on
5m, distrust wicks; Premium (seconds bars) is the later unlock *if the read changes decisions*
(user executes through Lucid inside TradingView, so TV Premium beats Sierra for workflow if
that day comes). TradingView-only for now — a sim CVD would need a Databento re-pull with
aggressor side (trades parquet has no side column); possible future slice. Plain-words usage
guide: **`docs/study/cvd-and-rsi.md`** (absorption/initiative reads + the 6-step chop-day RSI
playbook). CONTEXT.md gained a **Cumulative delta (CVD)** entry. *Pine can't run locally —
paste into TradingView's editor and report errors back (known loop).*

### #13 (2026-07-14) — prior-period levels & value areas: CODE DONE, awaiting a data pull
The expanded pre-session catalog. **All code is written + offline-verified; the one
remaining step is a Databento pull the USER runs** (needs the key + spends ~pennies of 1m data —
cannot run from chat). Because levels are no longer scored (see entry below), these are pure
**reference lines**; the Rust `Level` struct is generic (`id/label/kind/price`, ignores extra
keys), so **new levels draw with zero Rust/TS structural change**.
- **Pure math** (`ingestion/levels.py`, stdlib-only): `volume_profile` (distribute each 1m bar's
  volume across the bins its [low,high] spans) + `value_area` (POC/VAH/VAL, expand from POC taking
  the heavier neighbour to 70%, bin **centers**), `high_low`, `SESSION_WINDOWS` (ON/Asia/London ET
  minute spans — **open params**, CONTEXT marked TBD), per-symbol `VA_BIN`. Tests
  `ingestion/test_levels.py` (`python ingestion/test_levels.py`, 10 cases).
- **Ingestion** (`ingestion/fetch_day.py`): widened the levels window from a 5-day lookback to
  **first-of-prior-month → 09:30** (guarantees PD/PW/PM + prior-session/week VAs in range; still
  cheap 1m). New pure `compute_catalog(frame, day, symbol)` (network-free → offline-testable)
  computes **PD/PW/PM H/L**, **ON/Asia/London H/L**, and **prior-session + prior-week VAH/VAL/POC**.
  Answer key bumped to **schema_version 2** with kinds `period_hl` / `session_hl` / `value_area`.
  Offline windowing test `ingestion/test_catalog.py` (run with the venv:
  `.venv/Scripts/python.exe ingestion/test_catalog.py`, 16 cases — week/month/session boundaries,
  RTH-only filter, VA present). New **`--force-levels`** flag recomputes only the catalog (pair
  with `--no-ticks`) so you don't re-pull the 1s bars/ticks.
- **App** (`main.ts`): revealed levels are now **colored by kind** (`levelColor`: period amber /
  session emerald / value-area rose) and the reveal panel **groups** them (Period H/L · Session H/L
  · Value areas · Other). Back-compat: the legacy v1 `pre_session` file still renders (maps to amber
  / Period H/L). App `npm test` → **68**, typecheck + prod build clean.
- **⚠ TO FINISH #13 — user runs one command** (regenerates the real NQ 2024-08-05 numbers; the
  committed answer key is still the legacy 4-level v1 until then):
  `.venv/Scripts/python.exe ingestion/fetch_day.py --no-ticks --force-levels`
  Then commit the regenerated `data/levels/NQ-2024-08-05.json`. Acceptance criteria 2 & 3 are
  code-complete + offline-verified; criterion 1 (Tier-2 1m incl. overnight ingested) is the pull.

### Level-marking scoring REMOVED (2026-07-13) — marks are now a Prep ritual, not a graded drill
User call after using it: the level-marking **precision/coverage score wasn't useful**. Removed the
scoring; **kept** the Prep marking ritual (draw levels/zones before Play), the true-level **reveal**
on Commit (drawn as chart lines + listed — just no "nearest X pts" readout), the **bias** score, and
the **AI coaching**. Knock-on: this **cancels the #12 paid-data fork for scoring** — there's no
longer any reason to buy pre-09:30 data to expand a *scored* pre-session catalog (#12 criteria 1 & 2
stand; criterion 3's "scored expanded catalog" is retired, not deferred).
- **Engine** (`grade/reportCard.ts`, `grade/types.ts`): deleted `scoreLevelMarking` / `markCredit` /
  `LevelMarkingScore` / `LevelScore` / `TrueLevel` (grade's copy) and the per-symbol level tolerance
  params (`levelTolerancePts`/`levelDecayPts`). `ReportCard` is now just `{ bias }`;
  `buildReportCard(called, structure)`. `GradeConfig` keeps only `biasDirectionalFraction`.
- **Prompt** (`grade/grade.ts`): the coach is told the marks are an **unscored** discipline ritual —
  context for whether trades leaned on planned prices, not a graded drill. `entryProximityToMark`
  (a trade's distance to the nearest mark) is retained as narrative context — it was never a *score*.
- **UI** (`main.ts`): `renderReportCard` dropped the "Level marking / coverage·precision" section
  (now Bias + AI only); `renderReveal` lists the revealed levels **without** the proximity readout.
  The reveal LINES on Commit are unchanged (still drawn).
- **Tests**: removed the 3 level-scoring tests; `npm test` → **68**. Typecheck + prod build clean.
- **Docs debt**: SPEC §5 / ADR-0003 / decision-8 still describe precision-scored levels — **stale**;
  this entry is the authority until they're rewritten (left to the user's call).

### #12 outcome (2026-07-13) — intraday objective-level engine (no-cost half; paid fork deferred) — commit `1a42a6a`, issue OPEN (criterion 3 retired, see entry above)
Built the **buildable half** of #12 — the intraday OR/IB/VWAP engine — and **deferred the paid
half** (the *scored* expanded pre-session catalog + daily/weekly VWAP anchors need pre-09:30
history = a paid Databento re-pull; the fork was flagged 2026-07-12). Acceptance criteria: (1)
OR/IB/VWAP auto-computed + drawn live, unscored ✅; (2) pre-session precision-scored with per-symbol
tolerance ✅ (unchanged — `reportCard.ts` + `GRADE_CONFIGS` already did this and generalise over
whatever the answer key holds); (3) report card reflects the expanded catalog — **partial**: the
intraday catalog now folds into the grade digest as *unscored* context, but the *scored* pre-session
expansion (PW/PM H/L, VAs) awaits the paid re-pull.
- **Pure engine** (`app/src/engine/intradayLevels.ts`, portable TS): `IntradayLevels` folds the same
  forward 1s clock (ADR-0002, no look-ahead) into **Opening Range** (first 15m: high/low/mid, frozen
  at 09:45), **developing Initial Balance** (first 60m: high/low live, frozen at 10:30, then exposing
  25/50/75% retracements + fib **extensions** beyond each edge as breakout targets — `ibExtensions`
  open param, default `[0.5,1.0]`), and a **NY-open VWAP** curve (Σ(typical·vol)/Σvol). `levels()`
  gates the IB internals to `complete` so the developing view stays clean (OR edges/mid + IB edges),
  filling out the full catalog at 10:30. `foldIntradayLevels(bars)` = grade-time refold;
  `foldVwapCurve(curve, tf)` collapses the per-second VWAP to **one point per candle bucket** (LWC
  shares one time scale across series, so a finer line would splay the candles).
- **Chart** (`chartView.ts`): a dedicated `intradayLines` price-line layer (separate from the
  pre-session `setLevelLines` so they never clobber) — OR sky `#38bdf8`, IB orange `#fb923c`, dotted
  while developing → solid when frozen; a cyan VWAP **line series** (`setVwapCurve`/`updateVwap`).
- **Wiring** (`main.ts`): the attempt tick folds each second, grows VWAP on the active bucket, and
  redraws OR/IB only when the price set changes (`lastIntradayKey` dirty-check → no churn after
  10:30). `switchTimeframe` refolds the VWAP onto the new bucket grid (price-lines survive `setData`).
  **Review refolds over the now-unlocked full day** (`viewVwapCurve`) so OR/IB freeze and the VWAP
  line spans every candle even on an early concession.
- **Digest/coach** (`grade/{types,digest,grade}.ts`): `Digest.intradayLevels` (frozen catalog +
  final VWAP) rides into the AI call as **explicitly unscored** context — the prompt tells the coach
  to reference it when judging entries/exits (fade at IB edge, target at VWAP) but never to grade
  "marking" it. `roundForPrompt` rounds the prices.
- **Verified**: headless refold over the real whipsaw day — OR 17509.25–17872.25, IB
  17509.25–18112.50, VWAP 17554→17934.68 across 120 one-minute buckets (sane vs the 680pt first-2h
  range). `npm test` → **71** (+6 intraday: OR window open/freeze, IB develop→freeze +
  retracements/extensions gated to complete, VWAP volume-weighting, refold==live, bucket-fold
  alignment, empty-safe). Typecheck + prod build clean. *Interactive chart draw is a hand-check
  (repo convention for UX slices).*

### #11 UI pivot (2026-07-13) — order-centric scaling, TradingView-style (Option 2) — commit `9298e50`, issue closed
**Follow-ups deferred to a later slice** (open, noted here so they aren't lost): (a) resting *add*
lines aren't chart-draggable yet — cancel from the Working-orders panel or cancel+replace to
reprice (TP legs already drag); (b) a partial *sell-stop* reduce isn't wired — scale out via
limit/market, the attached stop covers the rest; (c) reduce-limit place/cancel emit no granular
audit event yet (sealed fills + `trade_closed` are complete). Engine mechanics under this pivot:

The staged **TP1/TP2/Runner widget was removed** in favour of the real-platform model: scaling is
emergent from **placing ordinary orders**, not a bespoke object. Engine + tests unchanged in intent;
this reshapes *how the trader drives it* (user chose Option 2 after we walked through how TV works).
- **Buy/Sell ticket** (was Long/Short). Flat: Buy opens long, Sell opens short. In a position:
  same-direction = **scale in**, opposite = **scale out** (`isAddOrder` maps side↔position).
- **Opening** = a plain bracket (entry + protective stop + one optional full-cover target).
- **In a position** the same Draw flow places an ordinary order: **market = one click** (immediate
  add / partial close); **limit/stop = click a price** (`BracketEditor.pickPrice` ghost line) →
  drops a **resting order**. Several may rest at once. A **Working orders** panel lists each add +
  take-profit leg with a ✕ to cancel; reduce legs stay draggable on the chart to reprice.
- **Close ½ / Close ×** on the position panel = market partial close (TV's position-panel affordance).
- **Engine additions** (`fillEngine.ts`): `targetCoversAll` moved to a **per-leg `coversAll`** flag
  (attached target covers all + grows with adds; ordinary reduce-limits are fixed size). `target`
  is now **optional** (stop-only brackets). `pendingAdd` → **`pendingAdds[]`** (multiple working
  adds, ids); new `placeReduceLimit(price,size)` rests a take-profit; `cancelAdd(id)`,
  `cancelTarget(index)`, `modifyAdd(id,price)`. `+3 fillEngine` tests (multiple working adds fill
  independently; placeReduceLimit partial then runner; kept the covers-all + straddle cases).
- **Tests** → **65** total; typecheck + prod build clean. Headless smoke: open long → buy-limit add
  fills on a dip → sell-limit TP banks a piece → full-cover target closes the runner (2 in / 2 out).
- **Deferred** (v1): a resting *add* line isn't chart-draggable yet (cancel from the panel, or
  reprice by cancel+replace); a partial *sell-stop* reduce isn't wired (scale out via limit/market;
  the attached stop covers the rest). Reduce-limit place/cancel emit no granular audit event yet
  (the sealed fills + `trade_closed` are complete).

### #11 outcome (2026-07-12) — scale-in / scale-out: full position lifecycle (ADR-0007)
*(Engine mechanics below still stand; the staged-target **UI** here was replaced by the order-centric
pivot above. The full-cover behaviour moved from a position-level flag to a per-leg `coversAll`.)*
A **Trade** is now a full position lifecycle — from flat, through any number of entry adds and
partial exits, back to flat — layered onto the proven single-bracket engine (the single-entry /
single-exit trade is the degenerate case, so the event log (ADR-0005) needs **no** structural
change: extra fills are more `fill` lines; `trade_closed` still fires once, at flat).
- **Pure engine** (`app/src/engine/fillEngine.ts`): a `Position` now tracks running `size`,
  size-weighted `avgEntry` (re-weighted on each add), the accumulators for a size-weighted average
  exit, and — the 1R anchor — `firstEntryPrice`+`initialSize`, **never rewritten by adds**.
  - **Scale-in**: `addToPosition(AddRequest, now)` queues a working market/limit/stop add (one at a
    time) that fills against the bar stream via the shared `fillPrice` helper and merges into the
    position. `cancelAdd` / `workingAdd` getter.
  - **Scale-out**: staged `targets: {price,size}[]` on the bracket (TP1/TP2/runner, fixed leg
    sizes), each filling clean at its price; plus manual `reducePosition(size, bar)` at market. A
    plain single `target` is **full-cover** (`targetCoversAll`): it protects scale-ins and hitting
    it closes the WHOLE position (so an add is never a naked runner — the fix below). The single
    protective **stop always covers the whole remaining size**.
  - **R** anchors to the first entry: `1R$ = initialSize × |firstEntry − initialStop| × $/pt`,
    `rMultiple = netUsd / 1R$`; total PnL computed from the balanced fills so it's exact regardless
    of fill order. **MAE/MFE** span the whole lifecycle. `Trade` gained `entryCount`/`exitCount`.
  - **Straddle integrity preserved**: `walkTicks` generalises the #4 tick-true resolver to legs —
    a print can take a partial target *before* the stop takes the rest (tick-true); no ticks →
    pessimistic full stop-out (never optimistic). The risky adjudication is identical at any size.
- **Session/grade**: no recorder change (fold reads `trade_closed`). `TradeDigest` carries
  `entryCount`/`exitCount`; the coach prompt tells the model to read a scaled position as management
  (adding into confirmation + banking partials = process; averaging down = not), size-weighted
  avg entry/exit, R anchored to the first entry — **not** to recompute.
- **UI** (`main.ts`, `index.html`, `style.css`): a scale row on the open position — **＋ Add**
  (market scale-in of the ticket Size), **－ Exit ½**, **－ Exit** (partial market scale-out). The
  position box shows a `scaled` line (N entries · M targets); the trades list shows `N in / M out`.
- **Staged-target UI (2026-07-12)**: a **Scale-out** selector in the ticket (`1× · TP+run ·
  TP1/2/run`) splits the ticket Size into 1–3 legs (`splitSize`: remainder to the earliest legs, so
  TP1 is largest and the Runner smallest; never more legs than contracts). `BracketEditor` was
  generalised from one target line to **N draggable target lines** (`DraftBracket.targets:
  {price,size}[]`, indexed drag handles, TP1/TP2/Runner labels with per-leg qty). On Arm, >1 leg
  goes through as `targets[]`; a single leg stays the full-cover target. Verified headless: enter ×3
  with TP1/TP2/Runner → legs fill 112/118 then the trailed stop takes the runner, one Trade,
  `exitCount 3`.
- **Draggable staged legs on the live position (2026-07-12)**: management now shows **every
  remaining** staged target as its own draggable line (TP1/TP2/Runner ×qty), not just the runner.
  New engine `modifyTarget(index, price)` retargets one leg; leg order is **stable** (legs are never
  re-sorted after placement, so an overlay index addresses the same leg until it fills — furthest is
  recomputed via `refreshFurthestTarget`, not "last"). `syncControls` re-attaches the manage overlay
  whenever a leg fills (`manageLegCount` guard), so a filled line drops off and the rest stay
  draggable. `+1 fillEngine` test: retarget a leg by a stable index, fill it at the moved price.
- **Hand-test fix (2026-07-12)**: a plain single target was covering only the *initial* size, so
  adding to the position left the added contracts as an unprotected runner and the target reveal
  read as "nothing happened." A single target is now **full-cover** (`targetCoversAll`) — hitting it
  closes the whole scaled position; explicit staged `targets[]` keep fixed leg sizes.
- **Tests**: TS `npm test` → 64 (+9 fillEngine: scale-in re-weights avg entry / 1R unchanged;
  single target covers scaled-in size; manual partial + runner in one trade; staged legs +
  trailed-stop runner; straddle-with-partial tick order; modifyTarget by stable index; lifecycle
  MAE/MFE; + 2 lifecycle guards).
  All prior fill/straddle/#10 cases pass unchanged (the single-bracket path is the degenerate case).
  Typecheck + prod build clean. *Interactive scale-row click-through is a hand-check.*

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

### Prep UX: range tool click-to-place (2026-07-12) — commit `8d22d1e`
Frontend-only, user-confirmed by hand. **▭ Range now mirrors ＋ Level**: it arms a dashed,
shaded **ghost band** (default ~100pt span, centred on the cursor) via
`LevelMarker.beginPlaceZone(seed, span)`; a click drops it and the high/low edges are then
draggable to size it (replacing the old drop-a-fixed-band-at-chart-centre). Level and zone
placement are **mutually exclusive** (arming one cancels the other) and both tear down on
Commit (`disable`) and on leaving Prep (`destroy`); `main.ts` `syncMarkTools()` reflects the armed
tool on both toolbar buttons. New CSS `.zone-band.ghost` (dashed purple, `pointer-events:none` so
it never eats the drop click). No engine/logic change; `npm test` unaffected, typecheck + build clean.

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
- Asia/Tokyo & London session **ET windows** — now defaulted in `ingestion/levels.py`
  `SESSION_WINDOWS` (Asia [18:00,03:00), London [03:00,09:30) ET); still tunable open params.
- **Value-area bin width** per symbol (`ingestion/levels.py` `VA_BIN`; NQ 2.0pt) + the 70% fraction.
- Commission per contract (+ default slippage already set: 1 tick on stops).
- Permission-lamp VWAP **flat-slope threshold** (chop vs trending) + slope lookback (ADR-0011).
- The Journal prompt list (structured prompts, ADR-0003 / CONTEXT).
- Volume-zone overlap threshold (~20% of top 3–4 ranges — profiles module).
- AI models: default `claude-sonnet-5`, `claude-opus-4-8` for deep end-of-module coaching (SPEC §5,
  wired in `app/src/grade/grade.ts`). Per-symbol grade tolerances/bias thresholds live in
  `app/src/grade/types.ts` (`GRADE_CONFIGS`) — NQ tuned first, others mirror it until hand-calibrated.

## Deferred by design (post-core, in order)
Calendar/module/progression (#17) → volume-profile histogram polish (#14) → micro↔mini (#19).
Base-rate stats (#18) computed **as-of the practiced day, no lookahead** (ADR-0008).
