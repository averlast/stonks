# Records are event-sourced, one append-only log per Session

## Status
accepted

## Context & decision
Records are git's source of truth (decisions 12–13) and must merge cleanly across machines.
The honesty thesis also requires that a committed prep cannot be edited after the outcome is
known. We therefore model each practice attempt as a **Session** — one attempt of a given
(historical-day, symbol) — and re-practicing the same day creates a **new** Session rather than
overwriting (repetition is the point of a rehearsal tool; progression tracking can then show
improvement on the same day over time).

Each Session is stored as an **append-only NDJSON event log**: one timestamped, typed event per
line (`prep_committed`, `order_placed`, `fill`, `stop_moved`, `flatten`, `journal_saved`,
`grade_computed`, …). The Session's *state* (frozen prep, trade tape, grade) is a **fold** over
those events. `prep_committed` carries a hash of the frozen prep, so editing the plan after the
fact is visible in git history — the integrity seal is structural, not promised. The optional
SQLite index (decision 12) is a **projection** rebuilt by folding the events.

## Considered options
- **One-shot per historical day** (spec's literal "one file per trading day") — simpler, but a
  day can never be re-drilled and a bad attempt permanently burns it.
- **Single mutable JSON document per day** — easier to read, but merges poorly, offers no
  tamper-evidence, and has no clean event→index projection story.

## Consequences
- The record unit is a Session, keyed by (historical-day, symbol, attempt), not just by day —
  a refinement of decision 12's "one file per trading day."
- Reading current state requires folding the event log (cheap; also cached in the SQLite index).
