import type { Sec1Bar, Timeframe } from "../types";
import { bucketStart } from "./aggregator";

/**
 * The intraday objective-level engine (#12, SPEC / CONTEXT). Folds the forward 1s
 * replay stream into the deterministic levels a trader watches DURING the session:
 *   - Opening Range (OR): high/low/mid of the first 15m of RTH (09:30–09:45 ET).
 *   - Developing Initial Balance (IB): high/low of the first 60m (09:30–10:30),
 *     growing live then frozen at 10:30, with the 25/50/75% internal retracements
 *     and fib extensions beyond each edge (breakout targets).
 *   - VWAP anchored at the NY open — a developing volume-weighted line.
 *
 * These are AUTO-computed and auto-drawn but NOT scored (only the blind pre-session
 * catalog is precision-scored — CONTEXT / ADR-0003). Pure and forward-only: it never
 * sees a future bar, so the live draw and a grade-time refold agree exactly.
 *
 * NOTE: the daily-open and weekly VWAP anchors, and the expanded *scored* pre-session
 * catalog (PW/PM H/L, Value Areas), need history before 09:30 — a paid Databento
 * re-pull — and are deferred (see PROJECT-STATE #12 fork). The NY-open anchor here is
 * fully computable from the 2h replay we already have.
 */

export interface IntradayConfig {
  /** Opening-Range window length in seconds (15m of RTH). */
  orSeconds: number;
  /** Initial-Balance window length in seconds (60m of RTH). */
  ibSeconds: number;
  /** IB extension projections beyond each edge, as fractions of the IB width
   *  (breakout targets). Open param — CONTEXT quotes "0.1–0.5+". */
  ibExtensions: number[];
}

export const DEFAULT_INTRADAY_CONFIG: IntradayConfig = {
  orSeconds: 15 * 60,
  ibSeconds: 60 * 60,
  ibExtensions: [0.5, 1.0],
};

/** One auto-computed intraday level. `complete` false = its window is still forming
 *  (the price will still move); true = frozen for the session. */
export interface IntradayLevel {
  id: string;
  label: string;
  price: number;
  group: "OR" | "IB";
  complete: boolean;
}

/** One sampled point of the developing VWAP line. */
export interface VwapPoint {
  t: number;
  value: number;
}

/** A frozen read of the engine — the final levels, the current VWAP, and its full
 *  developing curve — used at grade time (refold over the sealed day) and in tests. */
export interface IntradaySnapshot {
  levels: IntradayLevel[];
  vwap: number | null;
  vwapCurve: VwapPoint[];
}

export class IntradayLevels {
  /** RTH open epoch = the first bar's canonical second; windows measure from it. */
  private open: number | null = null;
  private orH = -Infinity;
  private orL = Infinity;
  private ibH = -Infinity;
  private ibL = Infinity;
  private orComplete = false;
  private ibComplete = false;
  // VWAP accumulators (NY-open anchor): Σ(typicalPrice·volume) / Σ(volume).
  private pv = 0;
  private vol = 0;
  private _vwap: number | null = null;
  /** Per-second developing VWAP, retained so a timeframe switch can refold it. */
  readonly vwapCurve: VwapPoint[] = [];

  constructor(private readonly cfg: IntradayConfig = DEFAULT_INTRADAY_CONFIG) {}

  /** Fold one 1s bar forward. Idempotent w.r.t. ordering only in that bars must
   *  arrive in clock order (the playback invariant, ADR-0002). */
  push(bar: Sec1Bar): void {
    if (this.open === null) this.open = bar.t;
    const dt = bar.t - this.open;

    // Opening Range: [open, open + orSeconds).
    if (dt < this.cfg.orSeconds) {
      if (bar.h > this.orH) this.orH = bar.h;
      if (bar.l < this.orL) this.orL = bar.l;
    } else {
      this.orComplete = true;
    }

    // Initial Balance: [open, open + ibSeconds).
    if (dt < this.cfg.ibSeconds) {
      if (bar.h > this.ibH) this.ibH = bar.h;
      if (bar.l < this.ibL) this.ibL = bar.l;
    } else {
      this.ibComplete = true;
    }

    // VWAP anchored at the open, using the bar's typical price (H+L+C)/3.
    const tp = (bar.h + bar.l + bar.c) / 3;
    this.pv += tp * bar.v;
    this.vol += bar.v;
    this._vwap = this.vol > 0 ? this.pv / this.vol : bar.c;
    this.vwapCurve.push({ t: bar.t, value: this._vwap });
  }

  get vwap(): number | null {
    return this._vwap;
  }

  get openRangeComplete(): boolean {
    return this.orComplete;
  }
  get initialBalanceComplete(): boolean {
    return this.ibComplete;
  }

  /**
   * The auto-levels currently defined. The Opening Range (frozen by 09:45) always
   * emits its high/low/mid once any bar is seen. The IB emits its developing edges
   * from the first bar; the internal retracements and extensions appear only once
   * the IB is complete (they are meaningless mid-formation and would only churn).
   */
  levels(): IntradayLevel[] {
    const out: IntradayLevel[] = [];

    if (this.orH > -Infinity) {
      const mid = (this.orH + this.orL) / 2;
      out.push(
        { id: "ORH", label: "OR high", price: this.orH, group: "OR", complete: this.orComplete },
        { id: "ORL", label: "OR low", price: this.orL, group: "OR", complete: this.orComplete },
        { id: "OR50", label: "OR mid", price: mid, group: "OR", complete: this.orComplete },
      );
    }

    if (this.ibH > -Infinity) {
      out.push(
        { id: "IBH", label: "IB high", price: this.ibH, group: "IB", complete: this.ibComplete },
        { id: "IBL", label: "IB low", price: this.ibL, group: "IB", complete: this.ibComplete },
      );
      const w = this.ibH - this.ibL;
      if (this.ibComplete && w > 0) {
        out.push(
          { id: "IB25", label: "IB 25%", price: this.ibL + w * 0.25, group: "IB", complete: true },
          { id: "IB50", label: "IB mid", price: this.ibL + w * 0.5, group: "IB", complete: true },
          { id: "IB75", label: "IB 75%", price: this.ibL + w * 0.75, group: "IB", complete: true },
        );
        for (const f of this.cfg.ibExtensions) {
          const tag = f.toFixed(f % 1 === 0 ? 0 : 2);
          out.push(
            { id: `IBup${f}`, label: `IB ext +${tag}`, price: this.ibH + w * f, group: "IB", complete: true },
            { id: `IBdn${f}`, label: `IB ext -${tag}`, price: this.ibL - w * f, group: "IB", complete: true },
          );
        }
      }
    }

    return out;
  }

  snapshot(): IntradaySnapshot {
    return { levels: this.levels(), vwap: this._vwap, vwapCurve: [...this.vwapCurve] };
  }
}

/** Fold a whole bar array to the final level set (grade-time refold + tests). */
export function foldIntradayLevels(
  bars: readonly Sec1Bar[],
  cfg: IntradayConfig = DEFAULT_INTRADAY_CONFIG,
): IntradaySnapshot {
  const il = new IntradayLevels(cfg);
  for (const b of bars) il.push(b);
  return il.snapshot();
}

/**
 * Collapse the per-second VWAP curve to one point per timeframe bucket (the last
 * VWAP in each bucket, at the bucket-start time) so it plots on the SAME time grid
 * as the candles — LWC shares one time scale across series, so a finer-grained line
 * would splay the candles apart. Matches the live `updateVwap` cadence.
 */
export function foldVwapCurve(
  curve: readonly VwapPoint[],
  tf: Timeframe,
): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  for (const p of curve) {
    const time = bucketStart(p.t, tf);
    const last = out[out.length - 1];
    if (last && last.time === time) last.value = p.value;
    else out.push({ time, value: p.value });
  }
  return out;
}
