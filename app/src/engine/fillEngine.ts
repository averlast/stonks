import type { Sec1Bar } from "../types";
import type { Contract, FillConfig } from "./contracts";
import type { ConfirmationFlags, SetupTag } from "./confirmation";

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
/** Why a fill happened. `flatten` = manual market exit; `end-of-day` = forced
 *  11:30 auto-flatten (#5). */
export type FillReason = "entry" | "stop" | "target" | "flatten" | "end-of-day";
/** How an exit was adjudicated. `tick-true` = resolved from the real print order
 *  of a straddled second (#4); `pessimistic` = stop-first fallback (#3). */
export type FillMethod = "clean" | "pessimistic" | "tick-true";

/** Returns the ordered prints for a second, or null when no tick cache is
 *  available (→ pessimistic fallback). Backed by the Rust `ticks_for_second`
 *  command under Tauri (ADR-0004). */
export type StraddleResolver = (t: number) => Promise<number[] | null>;

/** Stamps the objective confirmation flags for an entry from the multi-timeframe
 *  state at the fill second (#10). Injected (like the straddle resolver) so the fill
 *  engine stays portable — the caller reads the playback engine's 5m/15m snapshots
 *  and computes the flags. Returns null when no market context is available (dev). */
export type ConfirmationProvider = (ctx: {
  side: Side;
  entryPrice: number;
  t: number;
}) => ConfirmationFlags | null;

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
  /** The trader's setup archetype for this trade, from the SETUP_TAGS vocabulary (#10). */
  setupTag?: SetupTag;
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
  setupTag?: SetupTag;
  /** Objective confirmation flags stamped at entry (#10), null if unprovided. */
  confirmation?: ConfirmationFlags;
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
  setupTag?: SetupTag;
  /** The four objective confirmation flags present at entry (#10). */
  confirmation?: ConfirmationFlags;
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

/**
 * The moments the engine produces, in clock order — the raw material the Session
 * event log is folded from (ADR-0005 / #5). Emitted where each moment actually
 * happens, so the record can never disagree with the fills. `t` is the sim second
 * the moment occurred at (the current bar, or the last known second for
 * between-bar commands like place/cancel).
 */
export type FillEvent =
  | { kind: "placed"; t: number; orderId: string; req: BracketRequest }
  | { kind: "cancelled"; t: number; orderId: string }
  | { kind: "fill"; t: number; orderId: string; fill: Fill }
  | { kind: "stop_moved"; t: number; orderId: string; stop: number; target: number }
  | { kind: "closed"; t: number; orderId: string; trade: Trade };

export class FillEngine {
  private pending: PendingEntry | null = null;
  private position: Position | null = null;
  private _trades: Trade[] = [];
  private seq = 0;
  private onTrade: (t: Trade) => void = () => {};
  private emit: (e: FillEvent) => void = () => {};
  private resolver: StraddleResolver | null = null;
  private confirmationProvider: ConfirmationProvider | null = null;
  /** Latest sim second seen, so between-bar commands timestamp honestly. */
  private now = 0;
  /** Effective stop/target last written to the log, to coalesce a drag (which
   *  fires many modifyBracket calls) into one stop_moved per bar it takes hold. */
  private recordedStop = NaN;
  private recordedTarget = NaN;

  constructor(
    private contract: Contract,
    private config: FillConfig,
  ) {}

  /** Supply a tick source to resolve straddled seconds by true print order. */
  setStraddleResolver(fn: StraddleResolver): void {
    this.resolver = fn;
  }

  /** Supply the confirmation-flag stamper, called the moment an entry fills (#10). */
  setConfirmationProvider(fn: ConfirmationProvider): void {
    this.confirmationProvider = fn;
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
  /** Subscribe to the raw fill moments (place/fill/stop_moved/close). The Session
   *  recorder folds these into the append-only log (#5). */
  onEvent(cb: (e: FillEvent) => void): void {
    this.emit = cb;
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
    this.now = now;
    this.pending = { ...req, id, placedAt: now };
    this.emit({ kind: "placed", t: now, orderId: id, req: { ...req } });
    return id;
  }

  cancelPending(): void {
    if (this.pending) {
      this.emit({ kind: "cancelled", t: this.now, orderId: this.pending.id });
    }
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
    this.now = bar.t;
    if (this.pending) this.tryEntry(bar);
    if (this.position) {
      this.recordStopMove(bar.t); // log a trail/tighten at the bar it takes effect
      this.updateExcursions(bar);
      await this.tryExit(bar);
    }
  }

  /** Emit a stop_moved only when the effective stop/target actually changed since
   *  the last bar — a live drag calls modifyBracket continuously, but the honest
   *  record is the value that guarded this second. */
  private recordStopMove(t: number): void {
    const p = this.position!;
    if (p.stop !== this.recordedStop || p.target !== this.recordedTarget) {
      this.recordedStop = p.stop;
      this.recordedTarget = p.target;
      this.emit({ kind: "stop_moved", t, orderId: p.id, stop: p.stop, target: p.target });
    }
  }

  /** Market-flatten the open position at the current bar. `reason` distinguishes a
   *  manual flatten from the forced 11:30 end-of-day auto-flatten (#5). */
  flatten(bar: Sec1Bar, reason: FillReason = "flatten"): void {
    if (!this.position) return;
    const p = this.position;
    const price = p.side === "long" ? bar.c - this.slip : bar.c + this.slip;
    this.close(bar.t, price, reason, "clean");
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
      setupTag: e.setupTag,
      fills: [fill],
      maePoints: 0,
      mfePoints: 0,
      openedAt: bar.t,
    };
    // Stamp the objective confirmation flags from the market state at the fill (#10).
    if (this.confirmationProvider) {
      this.position.confirmation =
        this.confirmationProvider({ side: e.side, entryPrice: price, t: bar.t }) ?? undefined;
    }
    this.pending = null;
    // Seed the coalesce baseline so the opening bracket isn't mistaken for a move.
    this.recordedStop = e.stop;
    this.recordedTarget = e.target;
    this.emit({ kind: "fill", t: bar.t, orderId: this.position.id, fill });
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
    this.emit({ kind: "fill", t, orderId: p.id, fill: exitFill });

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
      setupTag: p.setupTag,
      confirmation: p.confirmation,
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
    this.recordedStop = NaN;
    this.recordedTarget = NaN;
    this.emit({ kind: "closed", t, orderId: p.id, trade });
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
