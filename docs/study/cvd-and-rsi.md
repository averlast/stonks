# Footprint & chop-day RSI — the plain-words playbook

How to actually use the "is this move real?" gauges: the **volume footprint** (every day,
at levels only) and TradingView's built-in RSI on chop days only. Written simple on
purpose. The glossary definitions live in `CONTEXT.md`.

---

## What happened to CVD (the short version)

The CVD pane (`tradingview/cvd.pine`, built 2026-07-30) was retired 2026-08-06 after live
use. Verdict: on Essential-plan data the line is built by classifying each 1-minute bar's
volume by close-vs-open — which is candle color restated. It agreed with the candles
because it mathematically almost had to; it could never add information. That's a verdict
on the *rendering*, not on delta as a concept. The footprint below shows the same thing
from real ticks, split by price and by side — so every absorption/initiative read from the
old playbook carries over, sharpened. The pine file stays in the repo but comes off the
chart.

---

## Part 1 — Footprint (use it every day)

### What it is, in one breath

Split a candle open. Inside is a ladder of price rows, each showing two numbers:
`sellers × buyers` — the volume that traded at that price by aggressive sellers (hitting
the bid) vs aggressive buyers (lifting the offer). Heavily lopsided rows get highlighted
as **imbalances**, and under each candle sits its **delta** (net buy − sell for the bar).
Where CVD gave one line for the whole session, the footprint shows *which prices, which
side, how much* — from real tick data.

### The one rule before anything else

**The footprint only means something at your levels.** ORB high/low, IB edges,
overnight/London levels, VWAP, value areas. In the middle of nowhere, ignore it
completely. Same discipline as before.

### The reads

**1. Absorption — the fade signal.** The failed-auction tell, frame by frame at (say)
the IB high:

- *The push*: rows into the level print heavy buyer numbers. Normal — that's what a
  test looks like.
- *The tell*: at the top few rows, buyer volume is huge but price stops advancing.
  Thousands of contracts lifting the offer at one price, and the next row up barely
  prints. Someone passive is selling them everything they want. **Big volume + no
  progress = absorption.**
- *The second tell — trapped buyers*: the poke bar closes; next bar the same top prices
  now print heavy *seller* numbers and the bar's delta flips negative while price is
  still near the high. Everyone who bought the breakout is underwater and starting to
  puke. That's fade fuel — visible well before the 30-minute close the failed-auction
  definition formally waits for.

Plain checklist: **heavy one-sided volume at the extreme + no price progress = the move
is hollow.**

**2. The thin top — the other exhaustion.** Sometimes the top row shows almost *no*
volume: price poked up and found nobody left to buy. Different flavor, same conclusion —
the break is hollow.

**3. Initiative — the continuation signal.** Price breaks the level and the rows show
**stacked buy imbalances** climbing through it; the heavy-volume price inside each bar
migrates upward bar over bar; on the retest, the pullback prints *light* volume until
buy imbalances reappear right at the retested level. Buyers aren't defending — they're
still paying up. The breakout is real; the retest is your entry context.

Plain checklist: **stacked imbalances through the level + light-volume retest that holds
= the move is real.**

### What the footprint does NOT do

- **It is not an entry trigger.** Permission, exactly like the regime table and the
  cloud. You still enter on your normal confirmation: the candle close, the volume, the
  engulfing.
- **Absolute numbers mean nothing across days.** Only the shape *within the moment* —
  volume vs progress, this bar vs the last few.
- **Absorption can lose.** Sometimes the absorber gets run over and price rips through
  anyway. That's why it's permission and not a trigger — the confirmation stack is what
  saves you when absorption fails.
- **It cannot see waiting walls** — only walls *being hit*. The forward-looking passive
  read (walls persisting, pulling, reloading before price arrives) is Bookmap's heatmap,
  which is deferred. One nice flip side: icebergs — hidden size invisible to the order
  book — *do* show up here, as absorption. This is where hidden defenders become visible.

### Practical notes

- Native footprint charts need **TV Premium**. Read on the 5m.
- Learn the raw read for a few weeks before layering on imbalance alerts or custom
  Pine (`request.footprint()` exists on Premium if we ever want our own rendering).

---

## Part 2 — RSI (chop days ONLY)

RSI is retired from trend days: on a real trend day it hits 70 early and *stays* there,
screaming "exhausted" for two hours while the market runs. Those are your best ORB
days, so it's most wrong exactly when it matters most. It keeps one honest job — a
stretch gauge on range days. The discipline:

1. **Decide it's a chop day first, without RSI.** Narrow IB, the 4H/1H regime table
   disagreeing, price flip-flopping across VWAP, breakouts that keep failing. If the
   day is trending, don't even open the pane.
2. **Only read it at the edges of the range.** Between 40 and 60 RSI is saying
   nothing. It earns attention only when price is at the range high or low you'd fade.
3. **Permission, not trigger.** Range high + RSI above 70 = the push is stretched,
   the fade has fuel. You still enter on the sweep + volume + engulfing, never on the
   RSI number alone.
4. **Wait for the curl.** Touching 70 means "stretched." Rolling back *under* 70 means
   "the push is letting go." Fade the curl, not the touch.
5. **Divergence is a bonus.** Second touch of the range high, price pokes slightly
   higher, RSI tops out lower — weaker second push, better fade. Pairs naturally with
   a double sweep.
6. **The escape hatch.** RSI pins above 70 and price refuses to drop from the edge?
   Your "chop day" call was wrong and a breakout is loading. Stop fading. The pin
   itself is the information.

One line to remember: **chop confirmed → edges only → permission not trigger → wait
for the curl → a pin means stop.**

---

## How the two share the work

| Day type | Exhaustion/stretch read | Why |
|---|---|---|
| Trend day | Footprint only | RSI pins; absorption in the rows is the only honest "it's ending" read |
| Chop day | Footprint at levels + RSI at range edges | They should agree; RSI adds the familiar 70/30 frame |
| Unsure | Footprint only until the day declares itself | RSI needs the regime call first; the footprint doesn't |
