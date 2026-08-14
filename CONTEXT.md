# ORB/IB Practice Simulator

A local, single-user practice environment for rehearsing Opening Range Breakout and Initial
Balance strategies against replayed historical index-futures sessions, graded on process
rather than outcome. This glossary fixes the language; implementation lives in code and ADRs.

## Language

### Strategy & market terms

**Opening Range**:
The high–low band of a session's opening window, per (instrument, session): index (NQ/ES) —
the first **15** and **30 minutes** of RTH (from 09:30 ET); gold — the first **15 minutes** of
the COMEX metals open (08:20–08:35 ET) and the first **5 minutes** of the Asia open
(18:00–18:05 ET). Each has a high, low, and **midpoint** (50%), all breakout/reaction levels.
An opening range is drawn **only for a session the user trades at its open**; every other
session contributes its H/L as liquidity **Level**s only — hence no London opening range
(resolved 2026-08-11). The sim's Opening Range remains the RTH 15m (09:30–09:45).

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
The wick's furthest point is the **sweep extreme** — the price that just proved it won't hold,
and therefore the structural anchor for a post-sweep stop. A **pin bar** (hammer / shooting
star) is a one-candle sweep — the wick is the run through the level, the close-back is the
reclaim — meaningful only at a **Level**, noise in open space.

**Coil**:
A tight consolidation at an obvious, widely watched **Level** (e.g. the OR midpoint) ahead of an
anticipated breakout. Read as **engineered liquidity**, not a launchpad: stops accumulate on both
sides of the coil, and the real break is routinely preceded by a **liquidity sweep** of the side
opposite the eventual direction (the spring/upthrust). Being right about the coming break entitles
the trade *after* that shakeout, not before it.
_Avoid_: "consolidation entry" — positioning inside a Coil is not a setup (resolved 2026-08-11,
see the Coil rule under Setups). Classical TA names for coils: **triangles, pennants, flags,
wedges** — all narrowing consolidations, all governed by the Coil rule. The pattern crowd buys
the drawn-trendline break with stops inside/behind the shape; a flag's low (in an uptrend) is a
favorite dip-collection point right before the continuation the flag crowd was positioned for.

**Equal extremes** (relative equal lows / equal highs):
Two-plus touches of roughly the same price — what classical TA charts as a **double/triple
bottom or top**. Read as a liquidity map only (resolved 2026-08-12): each touch *grows* the
stop pool just beyond the shared price (pattern-crowd stops + breakout entries), so equal
extremes are never faded directly — the **liquidity sweep** through them is the tradeable
event. The bounce-strength gradient decides what the sweep means: strong bounces → spring
(reversal, the paying "W" has a *lower* second low); weakening bounces → **Erosion** (the
floor is being eaten; the break continues). Note the classical read inverts here: a "triple
bottom" with weakening bounces is not extra-bullish, it is Erosion. Trend context
disambiguates further (2026-08-12, see **Auction bias gate**): equal lows sitting *in the
auction's path* — e.g. under a falling session VWAP — get ridden **through**, not defended;
the defended-spring read belongs to pools swept *against* the session's direction.

**Two-sided run** (steamroller):
A stretch where outsized wicks repeatedly harvest stops on *both* sides of a meandering
midrange (a "snaking neckline") — a balance auction or thin book collecting everyone
positioned near price, in either direction. No tactical stop distance is safe inside one:
the response is structural stops at reduced size, or standing aside — not a better entry.
Common in thin sessions (gold's Asia evening, lunch) and on chop days; often what the
**two-strike regime switch** is detecting.

**Erosion**:
Repeated tests of the *same* side of a range or Level, each bounce weaker than the last — passive
orders being consumed, not defended. The opposite read of a sweep: a level tested three-plus times
is expected to break, not hold. Distinguished from a **liquidity sweep** by tempo: sweep = one fast
wick with a sharp reclaim; erosion = slow, repeated, shallow. Erosion flips the trade to the break
*through* that side (on retest); fading an eroding edge is banned (third-test rule, Entry gates).

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

**Head & shoulders** (three-peak top; the inverse, a three-valley bottom, mirrors everything):
Read as a liquidity map only (2026-08-12). For the top version: price makes a high (first
peak — sellers' stops now sit above it), pushes *through* that high and fails (the middle,
tallest peak — this is usually a completed **liquidity sweep**, and the sweep-and-reclaim up
there was the actual short entry, long before the pattern has a name), then can't get back up
(the lower third peak). Pattern-following traders **sell** when price drops below the valley
floor between the peaks, and they park their protective **buy**-stops just above the third
peak. So after the pattern completes there is a known pocket of forced *buying* sitting above
the third peak: a bounce up into it that shakes out those sellers is expected stop collection,
not the pattern failing. If already short from the middle peak's sweep, the stop belongs above
that sweep's extreme — beyond the whole formation — so the shakeout bounce can't reach it.
Caveat: on a strong trend day price may run off without ever coming back for that pocket; the
map says where the fuel is, not that the market must stop for it.

**Gap** (RTH gap / gap fill):
The distance between today's RTH open and the prior day's RTH close; the zone between them
traded by nobody during regular hours, with the **prior close as its magnet Level** ("gap
fill"). A gap traps the overnight wrong-way crowd — gap up = trapped shorts with buy-stops
overhead (fuel above), plus fill-faders selling toward yesterday's close (pull below). The
first ~30 minutes decides which crowd pays: initiative *away* from the gap = **gap-and-go**
(don't fade it); rotation back *into* the zone = the fill is on. An unfilled gap stays a
standing magnet all session. Small gaps in balance fill routinely; trend-day gaps don't, and
the fill-traders become the fuel.

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
The two timeframes may disagree — a **split** state, always displayed rather than hidden, and
resolved conservatively: a split can never authorize **press** (see the unanimity rule under
**Auction bias gate**, resolved 2026-08-14). A live-chart operationalization of **HTF trend**
(borrowed from Peachy Investor).

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

**Setup families** (resolved 2026-08-14): the six archetypes split into the **continuation
family** (Breakout & retest, Retracement continuation — trades that need a trend to keep going)
and the **fade family** (Range trade, Failed auction, Liquidity-sweep reversal, Supply/demand
rejection — trades against an extreme, back toward balance). Setup legality composes from two
orthogonal locks: the **direction lock** (the side state permits long, short, both in chop, or
neither in stand-by) and the **family lock** (chop bans the continuation family and permits the
fade family both ways; trending states permit both families, direction-locked; stand-by permits
nothing). "Range trade fades only" in the two-strike rule means the fade *family*, not the one
archetype. Ambition (press/harvest) never changes legality — it is management, not permission.

**Coil rule** (adopted 2026-08-11): a **Coil** before an anticipated breakout is never entered from
inside. It is traded only as (a) a **Liquidity-sweep reversal** of the coil's far side — the
sweep-and-reclaim IS the trigger, stop beyond the **sweep extreme** — or (b) a **Breakout & retest**
after a clean break that ran without a shakeout. Missing the rare no-shakeout break is the accepted
cost of not being the liquidity.

**Entry gates** (adopted 2026-08-11, companions to the Coil rule):
1. **Spring-vs-erosion test** — sweep-reversal entries require a *fast* reclaim: close back inside
   within 1–2 candles on the signal TF, with **Confirmation** (volume/engulfing). A slow crawl back
   inside is **Erosion**, not a spring — no trade.
2. **Third-test rule** — three or more tests of the same edge = Erosion; fading that edge is off,
   and the break through it becomes the favored trade.
3. **No mid-impulse entries** — entries happen *at* structure (sweep reclaim or retest), never into
   an extended move. A break that never retests was never your trade; a retest that fails back
   inside the range is the **Failed auction** signal, not a dip to buy.
4. **Two-strike regime switch** — two stop-outs on the same directional idea reclassifies the day
   as **chop**: breakout playbook off, **Range trade** fades only, or done for the day.

**Auction bias gate** (adopted 2026-08-12): before any setup gets a name, two questions.
(1) *Which side of the session VWAP is price, and which way is VWAP sloping?* Four side states
(resolved 2026-08-14). Below a falling VWAP only short-side setups exist (sell failed pushes
into VWAP/cloud, short overhead-pool sweeps, short the erosion break); above a rising VWAP,
mirror it; oscillating around a flat VWAP = chop rules; and price/slope *disagreement* (price
above a falling VWAP, or below a rising one) = **stand-by** — the auction is mid-argument
(a reclaim attempt or a stretching pullback, decided only by what happens next), so no
directional setups *and* no chop fades until price returns to its side or the slope gives in.
Trading the reclaim itself is a judgment read at structure, outside the gate. The flat-slope
threshold is a tunable open param. The **HTF SMA regime** never overrides this — it sets **ambition**: press
or harvest. **Unanimity rule** (resolved 2026-08-14): **press** (scale out at the first
magnets, keep a runner, trail toward the far targets) requires all three verdicts to agree —
the session side, the 1h regime, and the 4h regime; *any* disagreement (HTF vs session, or a
1h/4h split) = **harvest** (nearest magnet stack, take the money, no runner) at reduced size —
timeframe disagreement is where **Two-sided run**s live. When the side state is chop, ambition
is undefined (chop rules already fix the behavior). Accepted cost: the 4h lags at genuine
regime turns, so the first press-worthy day of a new trend reads harvest — the runner is
forfeited, never the trade. (2) *Did the day's first
initiative move fail?* A **failed auction** at the open flips the target map: the pools in the
failed direction become supply, and the level stack in the other direction becomes the target
sequence. Corollary — the A+ lesson (2026-08-12): **a first sweep in an unresolved auction is
never A+.** Sweeps come in sequences until the argument ends; A+ requires the auction to have
finished arguing — erosion confirmed at the opposite edge, the bias gate aligned, or a **double
liquidity sweep**.

**Stop anchor** (adopted 2026-08-11): a stop is placed beyond the price that *invalidates the idea*,
never "just beyond" the entry level. Post-sweep entries anchor beyond the **sweep extreme** (the
price that just proved it won't hold); confirmation entries with no sweep yet anchor beyond the
invalidating structure. A stop tightened to sit inside the reachable liquidity zone is the trade
telling you it isn't a trade yet. (Sizing from stop distance was considered and deliberately left
discretionary — see Flagged ambiguities.)
Three stop **policies**, never mixed by halves (adopted 2026-08-12):
1. **Tight** — beyond the sweep extreme. Legal only after a *fast* reclaim, and only with the
   willingness to re-enter when a deeper second sweep runs it — paying twice is the price of tight.
2. **Structural** — beyond the price that invalidates the *day thesis* (e.g. the failed-auction
   high), sized down to fit the width.
3. **Conditional** — exit on evidence, not price: a 5m **close** through the thesis level (a wick
   is noise, a close is information), backed by a disaster stop at the structural level.
The banned hybrid: tight stop + no re-entry plan + full-conviction hold — the worst half of each.

**Permission lamp**:
The passive on-chart display of the current regime state and the resulting legality of each
setup archetype — vetoes with reasons, never entries. It operationalizes the **Auction bias
gate** and **Entry gates** as a read-only lamp: it may say a setup is banned and why, but it
never says "enter" or "conditions met" — its silence on triggers is the design, so a wrong
output fails safe (an unneeded stand-down, not a prompted entry). Judgment reads (footprint,
auction resolution, A+ quality) stay with the trader, as does the **failed-auction** target-map
flip — targets are not permissions, so it is outside the lamp (resolved 2026-08-14). The
**two-strike** counter is the lamp's one hand-set input (a live chart cannot see fills) and is
quarantined as such: visibly marked hand-set, its chop override labeled with its cause, and a
carried-over nonzero count challenged at each new session's open rather than silently obeyed.
_Avoid_: "signal", "trigger", "bot" — the lamp displays permission state; it does not act or point.

**Level**:
A horizontal price of interest, either auto-computed (PDH/PDL, prior-week/-month H/L, overnight
H/L, developing IB, POC/VAH/VAL) or drawn by the user in Prep.
_Avoid_: line, zone (a **Zone** is a user-drawn band, distinct from a single-price **Level**).

**RTH / ETH**:
Regular Trading Hours (the 09:30–11:30 ET replay window) vs Extended/overnight Globex hours.

**Trading window**:
The hours the user actually trades live: 09:30 to ~12:00 ET at the latest for index (NQ/ES) —
plus, for **gold**, the NY metals morning (from the 08:20 ET COMEX open) and the **Asia open**
(~18:00 ET, typically Sunday and Wednesday evenings). Levels are still marked per **full-day
market convention** — the user exits early but trades against participants who hold all day, so
the levels that matter are the ones *they* watch. Gold is live-chart-only; the sim stays NQ/ES.

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
- Position sizing from stop distance (fixed dollar risk per trade) — proposed 2026-08-11 alongside
  the **Stop anchor** rule, **not adopted**: sizing stays discretionary for now. Revisit if
  structural stops keep producing inconsistent dollar risk across trades.
