# ORB/IB Practice Simulator

A local, single-user practice environment for rehearsing Opening Range Breakout and Initial
Balance strategies against replayed historical index-futures sessions, graded on process
rather than outcome. This glossary fixes the language; implementation lives in code and ADRs.

## Language

### Strategy & market terms

**Opening Range**:
The high–low band of the first **15 minutes** of RTH (09:30–09:45 ET). Its high/low are the
ORB breakout levels.

**ORB** (Opening Range Breakout):
A strategy that trades a break of the **Opening Range**.

**IB** (Initial Balance):
The high–low range of the first **60 minutes** of RTH (09:30–10:30 ET); "IB fades" trade
reversals at its edges. **Developing IB** = that range as it forms live, frozen at 10:30.

**Overnight sessions** (Asia / London / ON):
Globex sub-sessions preceding the RTH open, each with its own high/low: **Asia/Tokyo**
[18:00–03:00 ET) and **London** [03:00–09:30 ET) — tunable windows, resolved 2026-07-20 from
the prior TBD — plus the whole **Overnight** span (18:00 ET prior day → 09:30 ET) giving
ONH/ONL. Asia and London H/L are watched as liquidity levels; "pre-market low" ≈ **London low**.

**Prior-session levels**:
PDH/PDL and prior-week/-month H/L. Scope differs by surface, deliberately: on the **live chart**
(TradingView) they follow market convention — the full **ETH day** (18:00→17:00 ET) and prior
**calendar** week/month — because those are the prices other traders watch; in the **sim's answer
key** they derive from **full prior RTH session(s)** (09:30–16:00). On gap days the two disagree.

**VWAP**:
Volume-weighted average price — a developing line drawn live, tracked at multiple **anchors**
(New-York-open, daily-open, weekly); used as dynamic support/resistance and a retracement target.

**Value Area** (VAH / VAL / POC):
The price band holding most of a session's volume — value-area high, value-area low, point of
control — computed for the prior session and prior week.

**High Volume Node** (HVN):
A band of elevated volume on a higher-timeframe visible-range profile, marked as a horizontal
support/resistance zone. Judgment-placed.

**Supply / Demand zone**:
A discretionary zone drawn on the higher timeframe (30m–4h) at the candle preceding an aggressive
opposite-colored engulfing candle — demand (support) or supply (resistance). Not precision-scored.

**Liquidity sweep**:
Price wicking through a key level to trip stops, then sharply reversing; a **double liquidity
sweep** is two coincident levels (e.g. IB low + London low) swept at once — an A+ signal.

**Cumulative delta** (CVD):
A running per-session total of aggressive buying minus aggressive selling (trades lifting the
offer minus trades hitting the bid), anchored at a session open — RTH 09:30 ET by default, ETH
18:00 selectable. Read as **shape against price at a Level**, never as an absolute number:
**absorption** = price makes a new extreme but CVD doesn't (aggressors pressing and getting
filled passively — reversal context); **initiative** = CVD expanding with price through a
retest (continuation context). On the live chart CVD is an approximation from lower-timeframe
bar direction, not true tick delta. **Superseded as the every-day read by the Footprint**
(2026-08-06): the bar-direction approximation is candle color restated, so the line cannot
meaningfully disagree with the chart; delta is now read per price via the **Footprint**.

**Footprint** (volume footprint):
A candle split into per-price rows, each showing aggressive sell × aggressive buy volume
traded at that price, plus the bar's **delta** (net buy − sell). Read only at **Level**s,
never in open space: **absorption** = heavy one-sided volume at an extreme with no price
progress (the pressing side is being filled passively — reversal context, the early
**failed auction** tell); **initiative** = stacked one-sided imbalances advancing through a
retest (continuation context). The successor to the **CVD** line as the every-day
exhaustion read — the same shape-reads, resolved to price and side from real ticks. It
shows walls *being hit* (including icebergs, as absorption), never walls *waiting* — resting
passive liquidity is a different signal (a heatmap read, not adopted).

**Failed auction**:
A failed IB breakout — price pokes outside the range then closes back inside (by definition a
30-minute candle close; read earlier on 1m/5m).

**Confirmation**:
Evidence a level will hold before entry — a candle **close** at/beyond the level on a signal
timeframe (often 5m), a **volume** increase, and an **engulfing** candle in the trade's
direction. Its opposite is an aggressive "catch the falling knife" entry at the raw level.

**IB retracements / extensions**:
IB mid (50%), 25%, 75% inside the range, and fib **extensions** (0.1–0.5+) beyond it used as
breakout targets. The **Opening Range** has an analogous 50% midpoint.

**HTF trend** (higher-timeframe trend):
The 1h/4h directional context; setups taken *with* the HTF trend are higher-probability.
On the live chart it is read via the **HTF SMA regime**.

**HTF SMA regime**:
The per-timeframe bull/bear verdict from the 50 vs 200 SMA on the 4h and the 1h: 50 above
200 = bull, 200 above 50 = bear. Read from **developing** values (the forming HTF bar counts).
The two timeframes may disagree — that split state is itself decision-relevant. A live-chart
operationalization of **HTF trend** (borrowed from Peachy Investor).

**EMA cloud**:
The shaded band between the 4- and 9-period EMAs on the **5-minute** timeframe — a momentum
read that keeps its 5m meaning on lower-timeframe charts (never recomputed per chart TF).
Three states: bull (4 over 9), bear (9 over 4), and **neutral** when the spread is within a
fraction of one bar's typical range (ATR-relative) — i.e. a cross is "one candle away." The
fraction is an open param.

**Base rate**:
A historical prior computed from the corpus (e.g. opening-candle continuation %, single-vs-double
IB break %, IB retracement depth) — always **as-of the practiced day** (trailing window ending the
day before), never the full corpus, to avoid lookahead.

### Setups (trade archetypes)

**Breakout & retest**: enter the continuation after price breaks a range (OR/IB) and retests it.
**Range trade**: fade one side of the range back toward the other.
**Retracement continuation**: after a breakout, enter a pullback to the 50%/VWAP, continuing.
**Failed auction (+ sweep)**: fade a failed breakout, strongest when it also sweeps liquidity.
**Liquidity-sweep reversal**: the bread-and-butter bounce — sweep of a key level + volume +
engulfing confirmation, taken with the HTF trend.
**Supply/demand rejection**: fade price into a drawn S/D zone on confirmation.

A **Session** typically runs ORB setups early, then switches to IB setups once the IB forms (~10:30).

**Level**:
A horizontal price of interest, either auto-computed (PDH/PDL, prior-week/-month H/L, overnight
H/L, developing IB, POC/VAH/VAL) or drawn by the user in Prep.
_Avoid_: line, zone (a **Zone** is a user-drawn band, distinct from a single-price **Level**).

**RTH / ETH**:
Regular Trading Hours (the 09:30–11:30 ET replay window) vs Extended/overnight Globex hours.

**Trading window**:
The hours the user actually trades live: 09:30 to ~12:00 ET at the latest. Levels are still
marked per **full-day market convention** — the user exits early but trades against participants
who hold all day, so the levels that matter are the ones *they* watch.

### Session & the five phases (the day spine)

**Session**:
One practice attempt of a given (historical-day, symbol), moving through the five phases below
and recorded as one append-only event log. Re-practicing the same day creates a **new** Session,
never an overwrite.
_Avoid_: "day" as the record unit — a historical day may hold many **Session**s.

**Prep**:
The graded, locked opening phase. Auto-levels are **hidden**; the user marks where they believe
the in-scope levels (and volume zones) are, draws discretionary zones, writes a prose bias, and
calls the day (bull/bear/chop), then **commits** — which reveals the true levels and scores the
marking. A scored "test your eye" drill, not an annotation of shown levels.

**Attempt**:
The forward-only phase where the sim clock runs and the user places and manages orders under
honest fills. No rewind, no peek.

**Review**:
The free-scrub phase, unlocked only after flatten/end-of-day, where the full session is
navigable in both directions with trades annotated.

**Journal**:
A set of structured reflection prompts (each free-text) stored verbatim in the day's record and
fed to the grader as-is — templated rather than a single blank box, for consistent gradable input.

**Grade**:
The day's assessment, persisted to the day's record, in two parts: an objective **Prep report
card** and an **AI synthesis** of adherence, execution, and outcome that combines hard data with
soft inputs. Organized along three axes: plan adherence, execution quality, outcome.

**Prep report card**:
The objective, engine-computed scoring of the Prep marks: **level-marking accuracy** (coverage +
precision), **volume-zone accuracy** (overlap % vs the true top 3–4 volume ranges; ships with the
profiles module), and the **bias call** vs the realized session.

**Bias call**:
The user's up-front guess of the day's character — **bull / bear / chop** — scored against how
the **first-2h traded window** (09:30–11:30 ET) actually resolved, not the full RTH day.

**AI synthesis**:
The grader's narrative coaching that layers hard data (trades, R, MAE/MFE, proximity of entries
to marked levels, consistency with the called bias) with soft data (journal, prose bias). It
interprets the objective numbers; it does not compute them.

**Commit**:
The irreversible act that freezes the Prep record and unlocks the Attempt; the frozen prep is
axis-1's reference.

### Trade & order terms

**Trade**:
One full position lifecycle — from flat, through any number of entry **adds** and partial
**exits**, back to flat — recorded as an ordered list of fills (each with price, size, time,
reason) plus level, logged reason, MAE, MFE, and R. A plain one-entry/one-exit trade is just
the simplest case.
_Avoid_: position (a **Position** is the live in-market state; a **Trade** is the completed record).

**Position**:
The live net in-market state during an Attempt — one net position per symbol at a time.

**Bracket**:
An entry order plus its attached protective **Stop** and profit **Target**, which are **OCO**.

**OCO** (one-cancels-other):
When the Stop or Target fills, the other is cancelled.

**R-multiple**:
A trade's result in units of risk. **1R = the dollar risk of the first entry** (initial size ×
initial-stop distance × $/pt); a trade's total R = total realized $ ÷ that 1R. Anchored to the
first entry and initial stop even if size is added or the stop is later moved.

**MAE / MFE**:
Maximum Adverse Excursion (worst unrealized move against the position before it worked) /
Maximum Favorable Excursion (best unrealized move in favor before exit).

**Scale-out** (partials / TP1, TP2, Runner):
Exiting a Position in pieces — e.g. TP1 at IB mid, TP2 at the range edge, a **Runner** trailed
toward the day's extreme.

**Scale-in** (add):
Adding to a Position on confirmation after a lighter starter entry (some at the sweep, more on
the retest).

**Trail / break-even**:
Moving the Stop as the trade works — aggressively to break-even to remove risk, then trailing.
R stays anchored to the initial stop (see **R-multiple**).

## Relationships

- A **Session** runs **Prep** → **Attempt** → **Review** → **Journal** → **Grade** in order; a
  **Prep** is **Commit**ted to unlock the **Attempt**, which produces zero or more **Trade**s.
- A historical day + symbol may have many **Session**s (re-attempts).
- A **Bracket** manages one **Position**; a closed **Position** becomes one **Trade**.
- A **Grade** = a **Prep report card** (objective) + an **AI synthesis** (hard + soft) over the
  frozen **Prep**, the **Trade** tape, and the **Journal**.
- **Trade**s are not pre-declared; adherence is assessed against the marked **Level**s and the
  **Bias call**, not against per-level directional commitments.

## Flagged ambiguities

- "trade" vs "position" — resolved: **Position** is live state, **Trade** is the completed
  round-trip record.
- "level" vs "zone" — resolved: a **Level** is a single price; a **Zone** is a user-drawn band.
- "auto-computed levels" (decision 8) — resolved into two classes: **objective levels**
  (deterministic — OR/IB + retracements/extensions, PDH/PDL, PW/PM H/L, Asia/London/overnight
  H/L, Value Areas, VWAP) which the hidden drill precision-scores; and **discretionary zones**
  (**Supply/Demand zones**, judgment-placed **HVN**s) which are drawn and AI-graded, not scored.
- "overnight" — resolved: the single ONH/ONL splits into distinct **Asia** and **London**
  session H/L; "pre-market low" ≈ **London low**.
- "prior day/week/month H/L" RTH vs ETH — resolved 2026-07-20: the **live chart** uses full ETH
  days + calendar weeks/months (market convention); the **sim** answer key stays RTH-only. A
  deliberate, known divergence — not a bug to reconcile.
