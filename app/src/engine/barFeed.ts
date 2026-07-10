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
  /** The next unseen 1s bar, or null at end of day. */
  next(): Promise<Sec1Bar | null>;
  /** Rewind to the start of the day (dev/testing only; the real wall is one-way). */
  reset(): void;
}

export interface DayMeta {
  symbol: string;
  date: string;
  count: number;
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
}
