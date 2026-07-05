# Grading: an objective Prep report card + AI hard/soft synthesis

## Status
accepted

## Context & decision
Spec axis 1 claims the grade "directly compares frozen prep vs the trade tape," but a prose
bias cannot be *directly* compared to anything. Rather than force the trader to pre-declare a
direction/setup per level (rejected — not how discretionary ORB/IB prep actually works), we
split grading into two buckets:

**1. Prep report card (objective, engine-computed).**
- **Level-marking accuracy** via a *hidden-level drill*: auto-levels are **hidden during Prep**;
  the trader marks where they believe the in-scope levels are; on **Commit** the true levels
  are revealed and scored on *coverage* (did you mark every in-scope level, per a configurable
  toggle set that grows over time) and *precision* (distance per mark — full credit within a
  few points, graceful decay outward; tolerance configurable per symbol).
- **Volume-zone accuracy**: overlap between marked zones and the true **top 3–4 volume ranges**
  (~20% overlap counts as a good mark), scored as a percentage. Ships with the profiles module
  (build step 2), not slice 0.
- **Bias call** (bull/bear/chop) scored against the realized session.

**2. AI synthesis (hard + soft).** The grader combines the hard digest (trades, R, MAE/MFE,
proximity of entries to marked levels, consistency with the called bias) with soft inputs
(journal, prose bias) to assess adherence + execution + outcome and coach. It narrates on top
of the objective numbers; it does not compute them.

Trades are **not** pre-declared as directional setups — the trader trades freely and adherence
is assessed against marked levels + the called bias.

## Considered options
- **Prose-only, AI-judged adherence** — subjective, non-reproducible run-to-run, and more
  expensive; undercuts the "process, not vibes" thesis.
- **Pre-declared directional plan items per level** — too rigid; not how discretionary prep works.

## Amendment — only pre-session levels are precision-scored
Levels split by *when they exist*. **Pre-session levels** (exist before 09:30 — PDH/PDL, PW/PM
H/L, Asia/London/overnight H/L, prior Value Areas, VWAP anchors) are hidden-drilled and
precision-scored. **Intraday developing levels** (Opening Range H/L complete at 09:45; IB H/L +
25/50/75 + extensions complete at 10:30; developing VWAP) are **hand-marked live by the user as
ritual but NOT scored** — you cannot test your eye on a level you are watching form. The system
independently auto-computes the true OR/IB values for the fill engine and grade digest regardless
of what the user drew. Discretionary **Supply/Demand zones** and **HVN**s remain AI-graded, not
precision-scored.

## Consequences
- Deviates from decision 8: auto-levels are hidden *during Prep* (still shown in Review).
- The engine computes **per-entry confirmation flags** into the digest — 5m close beyond the
  level, volume increase vs prior bars, engulfing candle in-direction, and with/against HTF
  trend — so "did you wait for confirmation vs catch a falling knife" is objective; the AI
  narrates on top. Each trade also carries a **user-supplied setup tag** (failed-auction /
  sweep-reversal / continuation / …) declaring intent, rather than the system auto-classifying.
- Needs a deterministic bias classifier (bull/bear/chop) scored against the **first-2h traded
  window** (not the full RTH day) — thresholds **to define** (see open items).
- Level tolerance (per symbol) and the volume-overlap threshold are configurable, tunable params.
- Slice-0 report card = level marks + bias call; volume-zone accuracy arrives with profiles.
