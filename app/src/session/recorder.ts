import { invoke } from "@tauri-apps/api/core";
import type { FillEngine, FillEvent } from "../engine/fillEngine";
import {
  fold,
  hashPrep,
  type Prep,
  type RecordedEvent,
  type SessionEvent,
  type SessionState,
} from "./events";

/** Where a recorded NDJSON line goes. Under Tauri it appends to the tracked
 *  session file via Rust; in browser dev / tests it's an in-memory no-op (the
 *  events still live in the recorder, so folding works). */
export type PersistSink = (line: string) => void | Promise<void>;

/**
 * Seals one Session (ADR-0005 / #5): stamps each fill moment and command into a
 * typed, append-only event log, in write order, and can reconstruct state by
 * folding. It owns no trade logic — it observes the FillEngine's moments and the
 * few Session-level acts (start, prep commit, end-of-day) around it.
 */
export class SessionRecorder {
  private events: RecordedEvent[] = [];
  private seq = 0;
  /** Serialises appends so NDJSON write order matches `seq`, even though the sink
   *  is async (a Rust round-trip). */
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private meta: { symbol: string; date: string; attempt: number },
    private persist: PersistSink,
  ) {}

  /** Open the log with the identifying event. `t` is 0 before the open. */
  start(t = 0): void {
    this.record(
      { type: "session_started", ...this.meta },
      t,
    );
  }

  /** Freeze the pre-market plan and seal its hash (Prep gate, #7). */
  commitPrep(prep: Prep, t = 0): void {
    this.record({ type: "prep_committed", hash: hashPrep(prep), prep }, t);
  }

  /** Subscribe to a FillEngine so every place/fill/stop-move/close is logged at
   *  the moment it happens. */
  attach(engine: FillEngine): void {
    engine.onEvent((e) => this.fromFill(e));
  }

  /** 11:30 reached: the attempt is sealed (the caller has already auto-flattened
   *  and cancelled working orders). */
  endOfDay(t: number): void {
    this.record({ type: "end_of_day" }, t);
  }

  get log(): readonly RecordedEvent[] {
    return this.events;
  }
  get state(): SessionState {
    return fold(this.events);
  }
  /** Resolves once every queued line has been flushed to the sink. */
  flushed(): Promise<void> {
    return this.tail;
  }

  // --- internals ------------------------------------------------------------
  private fromFill(e: FillEvent): void {
    switch (e.kind) {
      case "placed":
        this.record({ type: "order_placed", orderId: e.orderId, order: e.req }, e.t);
        break;
      case "cancelled":
        this.record({ type: "order_cancelled", orderId: e.orderId }, e.t);
        break;
      case "fill":
        // A forced market exit (manual flatten / end-of-day) is a `flatten`
        // command in the log; entries and protective stop/target exits are `fill`s.
        if (e.fill.reason === "flatten" || e.fill.reason === "end-of-day") {
          const cause = e.fill.reason === "end-of-day" ? "end-of-day" : "manual";
          this.record({ type: "flatten", orderId: e.orderId, cause, fill: e.fill }, e.t);
        } else {
          this.record({ type: "fill", orderId: e.orderId, fill: e.fill }, e.t);
        }
        break;
      case "stop_moved":
        this.record(
          { type: "stop_moved", orderId: e.orderId, stop: e.stop, target: e.target },
          e.t,
        );
        break;
      case "closed":
        this.record({ type: "trade_closed", trade: e.trade }, e.t);
        break;
    }
  }

  private record(e: SessionEvent, t: number): void {
    const full: RecordedEvent = { ...e, seq: ++this.seq, t, at: new Date().toISOString() };
    this.events.push(full);
    const line = JSON.stringify(full);
    this.tail = this.tail
      .then(() => this.persist(line))
      .catch((err) => console.error("session persist failed", err));
  }
}

/** Start a Tauri-backed session: creates a fresh, distinct attempt file in the
 *  tracked repo (never an overwrite) and returns the attempt number plus a sink
 *  that appends one NDJSON line per event. */
export async function startTauriSession(
  symbol: string,
  date: string,
): Promise<{ attempt: number; sink: PersistSink }> {
  const info = await invoke<{ attempt: number; path: string }>("start_session", { symbol, date });
  const sink: PersistSink = (line) => invoke("append_event", { line });
  return { attempt: info.attempt, sink };
}

/** Browser-dev / test sink: keep events in memory only (no repo write path). */
export const memorySink: PersistSink = () => {};
