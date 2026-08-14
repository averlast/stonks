# Chart patterns as liquidity maps

*Companion to CONTEXT.md's glossary entries (Equal extremes, Head & shoulders, Coil, Gap,
Two-sided run) and the 2026-08-11 entry rules (Coil rule, Entry gates, Stop anchor). Written
2026-08-12. The chop-day/footprint companion is `cvd-and-rsi.md`.*

## The one decision that governs everything here

**Patterns are liquidity maps, never entry signals.** (Resolved 2026-08-12.)

Classical patterns "work" not because shapes predict prices, but because enough traders act
on them identically that each pattern implies a *knowable cluster of entries and stops*. A
pattern tells you who is positioned where, and therefore where the forced orders (stops) sit.
Forced orders are fuel; fuel is where price gets pushed. You never trade the textbook form —
your entries remain the existing setups (sweep-reclaim, breakout & retest, range fade, failed
auction, S/D rejection). The pattern layer answers two questions on top:

- **Offensive:** where is the pool the market is likely to run *before* the real move — so the
  run becomes your trigger instead of your stop-out?
- **Defensive:** when I'm already positioned, which incoming shakeout is expected collection
  of *other people's* stops (hold), and where must MY stop sit so that collection can't reach
  it (beyond the structure, per the Stop anchor rule)?

The recurring shape of every section below: *textbook version → who's positioned where →
where their stops are → what you actually trade → what you hold through.*

## Double / triple bottoms & tops → "Equal extremes"

**Textbook:** two equal lows that hold = bullish; buy the second bounce or the neckline
break; stop below the lows. Triple bottom = stronger.

**The map:** equal lows are a *manufactured stop cluster*. Every textbook long has a stop
just below those lows; every breakout-shorter has a sell-stop entry there. The pool below
equal lows **grows with every touch**. Consequences:

- The double bottom that pays is the one whose second low *undercuts* the first and reclaims
  — the undercut is the pool being collected. That is literally the Liquidity-sweep reversal
  setup. Equal, untouched lows are a pending event, not support.
- **Triple bottoms: the textbook inverts here.** Classically "more touches = stronger." The
  liquidity read: watch the bounce gradient. Strong bounces = defended (but the pool below
  still gets collected eventually — expect the spring). *Weakening* bounces = Erosion — the
  floor is being eaten and the third-plus touch usually goes through. The crowd buying "the
  triple bottom" into weakening bounces is the fuel for the flush.
- **Defensive:** long from a spring, and equal lows later form above your entry? Other
  people's stops now cluster there; a dip to collect them is normal, not a thesis break —
  which is why your stop lives below the original sweep extreme, not below the new lows.

**The snaking neckline / steamroller wicks** (Two-sided run): when the midrange between
equal extremes wanders and giant wicks harvest both sides repeatedly, that's a balance
auction or thin book collecting everyone near price — common on gold's Asia evening and
lunch hours. No tactical stop distance survives it. The response is structural stops at
reduced size or standing aside; it is usually what the two-strike regime switch is detecting.

## Head & shoulders → "the head is the sweep"

**Textbook (top version; the inverse mirrors):** three peaks, middle tallest; short the
break of the neckline (the valley floor between peaks), stop above the right shoulder.

**The map, in sequence:**
1. First peak sets a high → stops accumulate above it.
2. The **head is the sweep of those stops** — the push through the first peak that fails and
   reclaims. *That sweep-reclaim was the short entry*, tradeable in real time, long before
   any "pattern" exists. By the time the shape has a name, the informed entry is gone.
3. The right shoulder is the failed attempt to get back up — confirmation supply is in
   control, nothing to trade by itself.
4. Neckline breakers short *late*, stops parked just above the right shoulder → a known
   pocket of forced **buying** above the third peak. The bounce that spikes into it and
   panics the neckline shorts is expected collection — the classic "failed H&S" that then
   drops for real.

**What you trade:** the head's sweep when it happens (setup #5), or the neckline retest
after the right-shoulder pool is collected (breakout & retest + the gates). **What you hold
through:** short from the head, the scary bounce into the right shoulder — your stop is
above the head's sweep extreme, beyond the whole formation.

**Caveat both ways:** on a strong trend day the market can run without returning for the
pool. The map says where fuel is, never that price must stop for it.

## Triangles / pennants / flags / wedges → they're all the Coil

Every narrowing consolidation is the Coil, and the Coil rule governs: never positioned
inside; enter on the far-side sweep-reclaim or the post-break retest. What the classical
names add to the map:

- The pattern crowd buys the *drawn trendline break* — a line everyone drew in the same
  place — with stops inside or behind the shape. Both the breakout entries and their stops
  are visible in advance.
- **Bull flag special case:** the flag's low is a favorite single dip-collection point. The
  flag crowd is long-biased waiting for the break; the dip through the flag low that stops
  them out, right before the continuation they were positioned for, is one of the most
  reliable sweeps on an index chart. Same mirrored for bear flags.
- Wedge "momentum divergence" folklore reduces to the absorption/erosion gradient you
  already read — no separate rule needed.

## Trading ranges → already native

A range's low-side spring and high-side failed push *are* the Liquidity-sweep reversal and
the Failed auction; the middle is the rotation your Range-trade fades traverse. Wyckoff's
accumulation/distribution schematics are older names for the same events (spring, upthrust).
Two map additions worth keeping:

- Range **edges** hold the stops (outside) and the breakout entries (also outside) — every
  edge test is a liquidity event, and the third-plus test obeys the Erosion read.
- The **measured-move targets** pattern traders project (range height, H&S head-to-neckline)
  create predictable take-profit clusters — modest magnets, useful for *your* target
  placement, not for entries.

## Gaps (NQ/ES; see the Gap glossary entry)

Gap up traps overnight shorts (buy-stops overhead = fuel above) and attracts fill-faders
selling toward yesterday's close (magnet below). First ~30 minutes decides which crowd pays:
initiative away from the gap = gap-and-go, don't fade; rotation back into the zone = the
fill is on and prior close is the target. Unfilled gaps remain standing magnets for days.
Small gap + balance conditions → fills routinely. Trend-day open → the fill-faders are the
fuel. The liquidity-map indicator draws the gap box until filled.

## Candlestick patterns (the short version)

One idea covers nearly all of them: **a pin bar / hammer / shooting star is a one-candle
liquidity sweep** — wick = the run through the level, close-back = the reclaim. Meaningful
only AT a Level (same rule as footprint reads); noise in open space. Engulfing candles are
already a Confirmation element. Dojis mean "balance," directionless alone. Multi-candle
patterns (morning star etc.) are just slower versions of the same sweep-and-reclaim.

## Cup & handle / rounding (why they're not in the glossary)

Slow accumulation shapes that rarely print cleanly intraday on futures. The transferable
ideas are already yours: a rounding bottom is the *mirror of Erosion* — successively higher
lows with weakening selling = sellers being absorbed — and the "handle" is a Coil. Read the
gradient and the coil; skip the pattern name.

## The tooling

`tradingview/liquidity-map.pine` draws the primitives this whole document reduces to:
**equal extremes** (pivot-based equal highs/lows, persisting until swept or broken, with
sweep markers) and **gap boxes** (prior RTH close → open, until filled). Named-pattern
auto-detection (H&S, cups) was deliberately skipped: the shapes are subjective and
detectors fire late and false — and under the maps-only rule, the pools are the signal,
not the shapes.
