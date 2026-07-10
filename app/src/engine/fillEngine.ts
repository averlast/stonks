import type { Sec1Bar } from "../types";
import type { Contract, FillConfig } from "./contracts";

/**
 * The fill engine — the integrity layer (SPEC §4). It adjudicates working orders
 * against the 1s bar stream and must NEVER be more optimistic than reality.
 *
 * This slice builds single-bracket trades (one entry + one OCO stop/target),
 * per the ADR-0007 guardrail: the risky logic is OCO adjudication + straddle
 * resolution, identical at any size, so scale-in/out layers on later unchanged.
 * A straddle bar (range touches both stop and target in one second) resolves
 * pessimistically (stop first); true tick-resolution arrives in #4.
 */

export type Side = "long" | "short";
export type EntryType = "market" | "limit" | "stop";
export type FillReason = "entry" | "stop" | "target" | "flatten";
/** How an exit was adjudicated. `tick-true` = resolved from the real print order
 *  of a straddled second (#4); `pessimistic` = stop-first fallback (#3). */
export type FillMethod = "clean" | "pessimistic" | "tick-true";

/** Returns the ordered prints for a second, or null when no tick cache is
 *  available (→ pessimistic fallback). Backed by the Rust `ticks_for_second`
 *  command under Tauri (ADR-0004). */
export type StraddleResolver = (t: number) => Promise<number[] | null>;

export interface Fill {
  t: number;
  price: number;
  size: number;
  reason: FillReason;
  method: FillMethod;
}

/** A bracket order request: an entry plus its attached protective stop + target. */
export interface BracketRequest {
  side: Side;
  entryType: EntryType;
  /** Required for limit/stop entries; ignored for market. */
  entryPrice?: number;
  stop: number;
  target: number;
  size: number;
  level?: string;
  reason?: string;
}

interface PendingEntry extends BracketRequest {
  id: string;
  placedAt: number;
}

interface Position {
  id: string;
  side: Side;
  size: number;
  avgEntry: number;
  initialStop: number;
  stop: number;
  target: number;
  level?: string;
  reason?: string;
  fills: Fill[];
  maePoints: number;
  mfePoints: number;
  openedAt: number;
}

export interface Trade {
  id: string;
  side: Side;
  level?: string;
  reason?: string;
  fills: Fill[];
  avgEntry: number;
  exitPrice: number;
  exitReason: FillReason;
  exitMethod: FillMethod;
  size: number;
  initialStop: number;
  riskPoints: number;
  maePoints: number;
  mfePoints: number;
  pnlPoints: number;
  pnlUsd: number;
  commissionUsd: number;
  /** Net realized $ ÷ 1R$, where 1R = first-entry dollar risk (ADR-0007). */
  rMultiple: number;
  openedAt: number;
  closedAt: number;
}

export class FillEngine {
  private pending: PendingEntry | null = null;
  private position: Position | null = null;
  private _trades: Trade[] = [];
  private seq = 0;
  private onTrade: (t: Trade) => void = () => {};
  private resolver: StraddleResolver | null = null;

  constructor(
    private contract: Contract,
    private config: FillConfig,
  ) {}

  /** Supply a tick source to resolve straddled seconds by true print order. */
  setStraddleResolver(fn: StraddleResolver): void {
    this.resolver = fn;
  }

  get trades(): readonly Trade[] {
    return this._trades;
  }
  get openPosition(): Position | null {
    return this.position;
  }
  get pendingEntry(): PendingEntry | null {
    return this.pending;
  }
  onClosed(cb: (t: Trade) => void): void {
    this.onTrade = cb;
  }

  private get slip(): number {
    return this.config.slippageTicks * this.contract.tickSize;
  }

  /** Place a bracket. One active bracket at a time this slice (single net position). */
  place(req: BracketRequest, now: number): string {
    if (this.pending || this.position) {
      throw new Error("an order or position is already active");
    }
    if (req.size <= 0) throw new Error("size must be positive");
    this.validateBracket(req);
    const id = `o${++this.seq}`;
    this.pending = { ...req, id, placedAt: now };
    return id;
  }

  cancelPending(): void {
    this.pending = null;
  }

  /** Move the live position's stop and/or target (trail, break-even, tighten).
   *  `initialStop` is untouched, so R stays anchored to the first stop (CONTEXT).
   *  Takes effect on the next bar's adjudication — no same-bar cheat. */
  modifyBracket(next: { stop?: number; target?: number }): void {
    const p = this.position;
    if (!p) return;
    if (next.stop !== undefined) p.stop = next.stop;
    if (next.target !== undefined) p.target = next.target;
  }

  /** Adjudicate one 1s bar in clock order. Entries first, then exits — including
   *  an exit on the very bar an entry fills (pessimistic: a whipsaw can stop you
   *  out the same second you get in). */
  async onBar(bar: Sec1Bar): Promise<void> {
    if (this.pending) this.tryEntry(bar);
    if (this.position) {
      this.updateExcursions(bar);
      await this.tryExit(bar);
    }
  }

  /** Market-flatten the open position at the current bar (manual exit). */
  flatten(bar: Sec1Bar): void {
    if (!this.position) return;
    const p = this.position;
    const price = p.side === "long" ? bar.c - this.slip : bar.c + this.slip;
    this.close(bar.t, price, "flatten", "clean");
  }

  // --- entries --------------------------------------------------------------
  private tryEntry(bar: Sec1Bar): void {
    const e = this.pending!;
    let price: number | null = null;

    if (e.entryType === "market") {
      // Fills at the first bar after placement.
      price = e.side === "long" ? bar.o + this.slip : bar.o - this.slip;
    } else if (e.entryType === "limit") {
      // Buy limit fills on a dip through; sell limit on a pop through. Clean fill.
      if (e.side === "long" && bar.l <= e.entryPrice!) price = e.entryPrice!;
      if (e.side === "short" && bar.h >= e.entryPrice!) price = e.entryPrice!;
    } else {
      // Stop-entry: buy stop above, sell stop below. Fills with slippage.
      if (e.side === "long" && bar.h >= e.entryPrice!) price = e.entryPrice! + this.slip;
      if (e.side === "short" && bar.l <= e.entryPrice!) price = e.entryPrice! - this.slip;
    }
    if (price === null) return;

    const fill: Fill = { t: bar.t, price, size: e.size, reason: "entry", method: "clean" };
    this.position = {
      id: e.id,
      side: e.side,
      size: e.size,
      avgEntry: price,
      initialStop: e.stop,
      stop: e.stop,
      target: e.target,
      level: e.level,
      reason: e.reason,
      fills: [fill],
      maePoints: 0,
      mfePoints: 0,
      openedAt: bar.t,
    };
    this.pending = null;
    this.updateExcursions(bar); // count the entry bar's excursion too
  }

  // --- exits ----------------------------------------------------------------
  private async tryExit(bar: Sec1Bar): Promise<void> {
    const p = this.position!;
    const stopHit = p.side === "long" ? bar.l <= p.stop : bar.h >= p.stop;
    const targetHit = p.side === "long" ? bar.h >= p.target : bar.l <= p.target;

    if (stopHit && targetHit) {
      await this.resolveStraddle(bar); // true tick order if available, else pessimistic
    } else if (stopHit) {
      this.exitAtStop(bar, "clean");
    } else if (targetHit) {
      this.close(bar.t, p.target, "target", "clean"); // limit/target fills clean
    }
  }

  /** A second whose range touched both stop and target. Ask the resolver for the
   *  real prints and honor whichever level the price reached first; fall back to
   *  pessimistic (stop first) when no ticks are available (ADR-0004, SPEC §4). */
  private async resolveStraddle(bar: Sec1Bar): Promise<void> {
    const p = this.position!;
    if (this.resolver) {
      const ticks = await this.resolver(bar.t);
      const first = ticks && ticks.length ? this.firstTouch(ticks, p) : null;
      if (first === "target") {
        this.close(bar.t, p.target, "target", "tick-true");
        return;
      }
      if (first === "stop") {
        this.exitAtStop(bar, "tick-true");
        return;
      }
    }
    this.exitAtStop(bar, "pessimistic");
  }

  /** Walk the prints in order; return which protective level price reached first. */
  private firstTouch(ticks: readonly number[], p: Position): "stop" | "target" | null {
    const long = p.side === "long";
    for (const px of ticks) {
      if (long ? px <= p.stop : px >= p.stop) return "stop";
      if (long ? px >= p.target : px <= p.target) return "target";
    }
    return null;
  }

  private exitAtStop(bar: Sec1Bar, method: FillMethod): void {
    const p = this.position!;
    const price = p.side === "long" ? p.stop - this.slip : p.stop + this.slip;
    this.close(bar.t, price, "stop", method);
  }

  private updateExcursions(bar: Sec1Bar): void {
    const p = this.position!;
    if (p.side === "long") {
      p.maePoints = Math.max(p.maePoints, p.avgEntry - bar.l);
      p.mfePoints = Math.max(p.mfePoints, bar.h - p.avgEntry);
    } else {
      p.maePoints = Math.max(p.maePoints, bar.h - p.avgEntry);
      p.mfePoints = Math.max(p.mfePoints, p.avgEntry - bar.l);
    }
  }

  private close(t: number, exitPrice: number, reason: FillReason, method: FillMethod): void {
    const p = this.position!;
    const exitFill: Fill = { t, price: exitPrice, size: p.size, reason, method };
    p.fills.push(exitFill);

    const { pointValue } = this.contract;
    const pnlPoints = p.side === "long" ? exitPrice - p.avgEntry : p.avgEntry - exitPrice;
    const commissionUsd = this.config.commissionPerContract * p.size * 2; // round turn
    const pnlUsd = pnlPoints * pointValue * p.size - commissionUsd;
    const riskPoints = Math.abs(p.avgEntry - p.initialStop);
    const oneRusd = riskPoints * pointValue * p.size;
    const rMultiple = oneRusd > 0 ? pnlUsd / oneRusd : 0;

    const trade: Trade = {
      id: p.id,
      side: p.side,
      level: p.level,
      reason: p.reason,
      fills: p.fills,
      avgEntry: p.avgEntry,
      exitPrice,
      exitReason: reason,
      exitMethod: method,
      size: p.size,
      initialStop: p.initialStop,
      riskPoints,
      maePoints: p.maePoints,
      mfePoints: p.mfePoints,
      pnlPoints,
      pnlUsd,
      commissionUsd,
      rMultiple,
      openedAt: p.openedAt,
      closedAt: t,
    };
    this._trades.push(trade);
    this.position = null;
    this.onTrade(trade);
  }

  private validateBracket(req: BracketRequest): void {
    if (req.entryType !== "market" && req.entryPrice === undefined) {
      throw new Error(`${req.entryType} entry needs an entryPrice`);
    }
    // Stop below / target above for longs (and mirror for shorts).
    if (req.side === "long" && !(req.stop < req.target)) {
      throw new Error("long bracket needs stop < target");
    }
    if (req.side === "short" && !(req.stop > req.target)) {
      throw new Error("short bracket needs stop > target");
    }
  }
}
