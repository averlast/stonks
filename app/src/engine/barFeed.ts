import { invoke } from "@tauri-apps/api/core";
import type { Sec1Bar } from "../types";

/**
 * A gated, forward-only source of 1-second bars.
 *
 * The engine can only ever pull the NEXT unseen second — it can never peek
 * ahead. This is the frontend half of ADR-0002's server-authoritative feed:
 * the shipped app backs `next()` with a Rust `next_sim_second` command so future
 * price is physically absent from the browser until the sim clock reaches it.
 *
 * The dev implementation below holds the whole day in memory (the documented
 * "TS engine first" caveat), but the engine is written only against this
 * interface, so swapping in the Rust-backed feed is a drop-in.
 */
export interface BarFeed {
  /** Metadata for the loaded day (populated by load). */
  readonly meta: DayMeta;
  /** The next unseen 1s bar, or null at end of day. */
  next(): Promise<Sec1Bar | null>;
  /** Rewind to the start of the day (dev/testing only; the real wall is one-way). */
  reset(): void;
  /** Concede the attempt and drop the no-peek wall (ADR-0002) — called on
   *  flatten/end-of-day so Review may take the whole day. */
  unlockReview(): Promise<void>;
  /** The full day's bars for Review's free bidirectional scrub. Rejects until
   *  the attempt has ended (server-enforced under Tauri). */
  reviewBars(): Promise<Sec1Bar[]>;
}

export interface DayMeta {
  symbol: string;
  date: string;
  count: number;
}

/** True when running inside the Tauri webview (vs. a plain browser dev server). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Production feed: bars live in Rust; we can only pull the next second (ADR-0002). */
export class TauriFeed implements BarFeed {
  meta: DayMeta = { symbol: "", date: "", count: 0 };

  async load(symbol: string, date: string): Promise<void> {
    this.meta = await invoke<DayMeta>("load_day", { symbol, date });
  }

  async next(): Promise<Sec1Bar | null> {
    return (await invoke<Sec1Bar | null>("next_sim_second")) ?? null;
  }

  reset(): void {
    void invoke("reset_feed");
  }

  async unlockReview(): Promise<void> {
    await invoke("unlock_review");
  }

  async reviewBars(): Promise<Sec1Bar[]> {
    return await invoke<Sec1Bar[]>("review_bars");
  }
}

/** Dev-only feed backed by the JSON dumped by ingestion/export_dev_json.py. */
export class DevJsonFeed implements BarFeed {
  private bars: Sec1Bar[] = [];
  private i = 0;
  meta: DayMeta = { symbol: "", date: "", count: 0 };

  async load(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`feed load failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    this.bars = data.bars as Sec1Bar[];
    this.meta = { symbol: data.symbol, date: data.date, count: data.count };
    this.i = 0;
  }

  async next(): Promise<Sec1Bar | null> {
    if (this.i >= this.bars.length) return null;
    return this.bars[this.i++];
  }

  reset(): void {
    this.i = 0;
  }

  // Dev has the whole day in memory already; the wall is Tauri's job (ADR-0002).
  async unlockReview(): Promise<void> {}
  async reviewBars(): Promise<Sec1Bar[]> {
    return this.bars.slice();
  }
}
