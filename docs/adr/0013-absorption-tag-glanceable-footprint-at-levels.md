# Absorption tag: a bar-close, level-scoped footprint read, replacing the permission lamp

## Status
accepted

## Context & decision
The **Footprint** (adopted 2026-08-06) is the every-day exhaustion read, but its UX is a grid of
per-price buy×sell rows on every candle — zoom-dependent, readable one bar at a time, and paid for
across the whole chart when the doctrine only ever reads it *at a Level*. The **Permission lamp**
(ADR-0011), meanwhile, never actually made it onto the live chart: its enumerated per-setup
legality was more than the eye wanted mid-trade. Both point at the same gap — a glanceable,
level-scoped order-flow read.

Decided, 2026-09-05:

1. **A new indicator, the Absorption tag** (CONTEXT.md), takes the retired lamp's slot — no net
   add to the roster. It surfaces the *one* Footprint read the playbook uses — **absorption vs
   initiative** — as a single mark at a Level.
2. **Level-scoped trigger, on approach.** The tag evaluates when price is within a per-instrument
   proximity of a mechanical Level at the 5m close — an approach/test, not only a completed
   **liquidity sweep**. Silent everywhere else (the Footprint's "only at Levels" rule made
   automatic).
3. **Word-first, three axes** (revised 2026-09-06 — the original colour/boldness gradient was
   undecodable on a busy chart without a legend): the **word** is the action — FADE (heavy one-sided
   volume at the tested extreme, bar closes rejected away → reversal) or PUSH (volume pushes through
   → continuation); a **★** marks strong flow (footprint conviction); a **stretch suffix** folds in
   **VWAP stretch** — `· prime` on a fade >20% ADR from VWAP (room to VWAP), `· scalp!` on a push
   >20% from VWAP (don't chase). ★ (how sure) and suffix (how far) are independent and stack. Colour
   only reinforces. This put the VWAP-stretch check onto the read the user is already watching,
   rather than building stretch as a separate meter — the point being to offload the check when
   attention is split across several charts.
4. **Bar-close only, never repaints.** The absorbed/running call depends on where the bar closes
   relative to the tested extreme, known only at close. An intrabar mark would settle after the
   fact and flatter every reversal in hindsight — the exact self-deception the research brief
   forbids. Cost accepted: up to a 5m wait for the confirmed mark; the live footprint is there for
   the early peek by eye.
5. **5m read, persists onto 1m** (the EMA-cloud cross-TF trick), reading the **mini/full-size**
   footprint (ES/NQ), never the micros — institutional size is in the full-size book.
6. **Levels via a shared Pine `library`.** The tag recomputes the mechanical Levels internally to
   know where to fire but does not redraw them; the level maths moves into one library imported by
   orb-index/orb-gold and the tag, retiring the copy-paste of level maths across five files.

Alongside: **RSI** dropped (redundant with **VWAP stretch** — same "overextended" job, but stretch
is in ADR units anchored to VWAP, not a floating 0–100), and **`cvd.pine`** retired (superseded by
the Footprint per the 2026-08-06 note).

## Considered options
- **Fold the tag into orb-index/orb-gold** — rejected: those are already the busiest indicators,
  and a standalone tag reads cleaner and drops into the freed lamp slot.
- **Intrabar (live) marking** — rejected outright: repainting an absorption read is the definition
  of fooling yourself, against the brief's core value.
- **Native footprint on whatever chart TF is shown** — rejected: 1m rows are too thin for a real
  absorption read; the mark would fire on noise. Pin it to 5m.
- **Read the levels from orb-index via `input.source()`** — rejected: Pine sandboxing exposes only
  one plotted series per input, hopeless for a dozen labelled levels. Recompute (they are
  deterministic) via a shared library instead.
- **Recompute levels inside the tag with no library** — deferred alternative: smaller change, but
  leaves the level maths duplicated; the library is the move that actually declutters.
- **Trigger on completed sweeps only** — widened to approach/test: absorption happens on a level
  test without a clean wick-through, and the bar-close rejected-vs-through discriminator still works.

## Consequences
- The Footprint stays as the raw, judgment read; the tag is its automatic, binary distillation —
  when they disagree, the eye on the Footprint wins (the tag is the glance, not the authority).
- Building this requires refactoring the ORB indicators to import the shared levels library — the
  first real consolidation of the duplicated level maths, and the template for pruning further.
- **Resolved 2026-09-05:** `request.footprint(ticks_per_row, va_percent=70, imbalance_percent=300)`
  has **no symbol parameter** — it reads only the current chart's bar. So cross-symbol is impossible;
  you **chart the mini (ES/NQ) directly** to read its flow. The "5m read persists onto 1m" goal is
  therefore *not* free either (footprint isn't a plain series you can wrap in `request.security`);
  v1 of the tag is **5m-native** (run it on a 5m chart), and the 1m-persistence is a later item
  pending a test of whether footprint survives a `request.security` wrapper.
- Object budget is a non-issue (the tag is sparse and caps kept labels), but confirm in TV.
- **Final tag level set (2026-09-06):** PDH/PDL, ONH/ONL, Pre-Tokyo H/L, session VWAP. **Round
  numbers** dropped (tested ~1.1× chance, no edge — see the Level term); **prior-day POC** and
  **settlement** dropped too — the user doesn't trade off either, so they stay out to keep the tag
  lean rather than because they're hard to build.
- Absorption-vs-thin-book is still **unproven on history** (no stored delta/volume-at-row; see the
  Footprint research brief) — the tag renders the read faithfully but does not validate that the
  read pays. That validation needs a Databento re-fetch with size + aggressor side.
