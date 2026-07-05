# Pre-fetch per-day ticks at ingestion for ambiguous-bar resolution

## Status
accepted

## Context & decision
When a 1s bar straddles both a working stop and target, §4 requires resolving the true fill
order from that second's ticks (pessimistic "stop first" fallback if unavailable). This must
happen **at the moment the sim clock reaches that second** — deferring to Review/Grade time
would fork the timeline, because subsequent trades depend on whether that second was a win or
a loss. The app is also offline-first (Tauri) with a Rust-gated bar feed (ADR-0002).

Therefore the Python ingestion script, when it first pulls a practice day, fetches **both** the
1s OHLCV bars **and** the raw ticks for the same 09:30–11:30 ET window, storing the ticks in the
Rust-gated cache alongside the bars. Ambiguous-second resolution is then **fully offline,
deterministic, and timeline-consistent**. Each trade records which method resolved it
(tick-true vs pessimistic) so honesty is auditable.

This does not violate §2.1: that rule forbids storing sub-second *bars* for rendering/context.
This is a small per-day tick cache used *only* for fill adjudication, fetched lazily only for
days actually practiced (one symbol, 2 hours), so cost stays near zero.

## Considered options
- **Live on-demand fetch during the Attempt** — minimal data, but couples the Attempt to the
  network, adds mid-trade latency, and makes the same day replay differently by connectivity.
- **Pessimistic-only in slice 0, tick-resolution as fast-follow** — simplest, but the first
  whipsaw-day validation would test only the conservative approximation, not true sequence.

## Consequences
- Ingestion pulls two schemas per practice day (ohlcv-1s + trades) for the 2h window.
- The gated cache stores ticks as an adjudication-only side input, never rendered or fed to the
  chart; free-scrub Review still runs off 1s/1m bars.
