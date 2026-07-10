import type { Sec1Bar, Candle, Timeframe } from "../types";
import type { BarFeed } from "./barFeed";
import { TimeframeAggregator } from "./aggregator";

/** Co-primary timeframes folded live off the single 1s clock (ADR-0002). */
export const TIMEFRAMES: Timeframe[] = [60, 300, 900];

export type Speed = 1 | 5 | 30;

export interface Tick {
  simSecond: Sec1Bar; // the 1s bar just processed
  forming: Map<Timeframe, Candle>; // current forming candle per timeframe
  sealed: Map<Timeframe, Candle | null>; // candle that just sealed, if any
  index: number; // count of seconds processed so far
}

/**
 * The authoritative simulation clock (ADR-0002). Advances exactly one sim-second
 * per step, feeding every 1s bar through the aggregators in order. Speed controls
 * change ONLY the wall-clock cadence — never which bars are processed — so a
 * grade is identical at 1x, 5x, or 30x.
 *
 * Retains SEALED (past) candles per timeframe so a timeframe switch can rebuild
 * the chart; it never holds future bars — those live behind the gated feed.
 */
export class PlaybackEngine {
  private aggs = new Map<Timeframe, TimeframeAggregator>();
  private history = new Map<Timeframe, Candle[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _playing = false;
  private _speed: Speed = 1;
  private _index = 0;
  private _ended = false;
  private onTick: (t: Tick) => void = () => {};
  private onEnd: () => void = () => {};

  constructor(private feed: BarFeed) {
    for (const tf of TIMEFRAMES) {
      this.aggs.set(tf, new TimeframeAggregator(tf));
      this.history.set(tf, []);
    }
  }

  subscribe(onTick: (t: Tick) => void, onEnd: () => void): void {
    this.onTick = onTick;
    this.onEnd = onEnd;
  }

  get playing(): boolean {
    return this._playing;
  }
  get speed(): Speed {
    return this._speed;
  }
  get index(): number {
    return this._index;
  }
  get ended(): boolean {
    return this._ended;
  }

  historyOf(tf: Timeframe): readonly Candle[] {
    return this.history.get(tf)!;
  }
  formingOf(tf: Timeframe): Candle | null {
    return this.aggs.get(tf)!.current;
  }

  setSpeed(s: Speed): void {
    this._speed = s;
    if (this._playing) {
      this.stopTimer();
      this.scheduleNext(); // reschedule at the new cadence; no bars skipped
    }
  }

  play(): void {
    if (this._playing || this._ended) return;
    this._playing = true;
    this.scheduleNext();
  }

  pause(): void {
    this._playing = false;
    this.stopTimer();
  }

  /** Advance exactly one sim-second. Works while paused → single-bar step. */
  async step(): Promise<boolean> {
    if (this._ended) return false;
    const bar = await this.feed.next();
    if (bar === null) {
      this._ended = true;
      this.pause();
      this.onEnd();
      return false;
    }
    this._index++;

    const forming = new Map<Timeframe, Candle>();
    const sealed = new Map<Timeframe, Candle | null>();
    for (const [tf, agg] of this.aggs) {
      const r = agg.push(bar);
      forming.set(tf, r.forming);
      sealed.set(tf, r.sealed);
      if (r.sealed) this.history.get(tf)!.push(r.sealed);
    }

    this.onTick({ simSecond: bar, forming, sealed, index: this._index });
    return true;
  }

  private scheduleNext(): void {
    const delay = 1000 / this._speed; // cadence only (ADR-0002)
    this.timer = setTimeout(async () => {
      if (!this._playing) return;
      const ok = await this.step();
      if (ok && this._playing) this.scheduleNext();
    }, delay);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
