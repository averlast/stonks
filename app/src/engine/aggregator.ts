import type { Sec1Bar, Candle, Timeframe } from "../types";

/** Epoch (seconds) of the bucket that timestamp `t` falls into for timeframe `tf`.
 *  1m/5m/15m boundaries align on both ET and UTC (the offset is whole hours), so
 *  flooring the epoch is correct. */
export function bucketStart(t: number, tf: Timeframe): number {
  return Math.floor(t / tf) * tf;
}

/**
 * Folds a forward stream of 1-second bars into candles for ONE timeframe,
 * exposing the live-forming right-most candle. This is the core of the playback
 * engine (SPEC §7 / ADR-0006: the risk lives here).
 *
 * `push()` returns the (possibly grown) forming candle, plus the previous candle
 * iff this bar opened a new bucket — so callers can append sealed history exactly
 * once. A sealed candle object is never mutated again and is safe to retain.
 */
export class TimeframeAggregator {
  private forming: Candle | null = null;

  constructor(public readonly tf: Timeframe) {}

  get current(): Candle | null {
    return this.forming;
  }

  push(bar: Sec1Bar): { forming: Candle; sealed: Candle | null } {
    const start = bucketStart(bar.t, this.tf);

    if (this.forming === null || start > this.forming.time) {
      const sealed = this.forming; // null only on the very first bar
      this.forming = {
        time: start,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      };
      return { forming: this.forming, sealed };
    }

    // Same bucket: grow the forming candle off the 1s bar.
    const f = this.forming;
    if (bar.h > f.high) f.high = bar.h;
    if (bar.l < f.low) f.low = bar.l;
    f.close = bar.c;
    f.volume += bar.v;
    return { forming: f, sealed: null };
  }

  reset(): void {
    this.forming = null;
  }
}
