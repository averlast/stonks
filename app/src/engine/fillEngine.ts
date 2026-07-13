import type { Sec1Bar } from "../types";
import type { Contract, FillConfig } from "./contracts";
import type { ConfirmationFlags, SetupTag } from "./confirmation";

/**
 * The fill engine — the integrity layer (SPEC §4). It adjudicates working orders
 * against the 1s bar stream and must NEVER be more optimistic than reality.
 *
 * A Trade is a full position lifecycle (ADR-0007 / #11): from flat, through any
 * number of entry adds (scale-in) and partial exits (scale-out), back to flat,
 * recorded as an ordered list of fills. The single-entry / single-exit trade is the
 * degenerate case, so nothing about the event-sourced record (ADR-0005) changes:
 * extra fills are just more `fill` lines and the sealed `trade_closed` still fires
 * once, when size returns to flat.
 *
 * Scaling is modelled the way a real platform works (#11, Option 2): you place
 * ORDINARY orders on an open position — a same-direction order (`addToPosition`)
 * scales in; a resting opposite-direction limit (`placeReduceLimit`) or a market
 * reduction (`reducePosition`) scales out. The attached bracket is just a protective
 * stop that covers the whole remaining size, plus an optional full-cover target.
 *
 * R anchors to the FIRST entry's risk: 1R$ = initial size × initial-stop distance
 * × $/pt; total R = net realized $ ÷ 1R$ (ADR-0007). Adds never rewrite 1R. The
 * risky adjudication (OCO, straddle/tick resolution) is identical at any size. A
 * straddle second (range touches both stop and a target) resolves by true print
 * order when ticks are available (#4), else pessimistically (stop first).
 */

export type Side = "long" | "short";
export type EntryType = "market" | "limit" | "stop";
/** Why a fill happened. `flatten` = manual market exit (full or partial scale-out);
 *  `end-of-day` = forced 11:30 auto-flatten (#5). */
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

/** One resting take-profit order on the position (a limit on the exit side). Fills
 *  `size` contracts at `price`. `coversAll` legs (the attached bracket target) exit
 *  the WHOLE remaining position — so scale-ins stay protected — whereas an ordinary
 *  reduce-limit the trader places exits only its own size (#11). */
export interface TargetLeg {
  price: number;
  size: number;
  coversAll?: boolean;
}

/** A bracket order to OPEN a position: an entry, a protective stop that covers the
 *  whole position, and an optional full-cover target. Scale-out into pieces is done
 *  afterwards by placing ordinary reduce orders, not by pre-declaring legs. */
export interface BracketRequest {
  side: Side;
  entryType: EntryType;
  /** Required for limit/stop entries; ignored for market. */
  entryPrice?: number;
  stop: number;
  /** Optional full-cover take-profit. Omitted = stop-only bracket; scale out by
   *  placing reduce orders. */
  target?: number;
  /** Optional pre-declared staged legs (kept for the engine/tests; the UI now
   *  builds these by placing ordinary reduce-limits instead). Fixed per-leg size. */
  targets?: TargetLeg[];
  size: number;
  level?: string;
  reason?: string;
  /** The trader's setup archetype for this trade, from the SETUP_TAGS vocabulary (#10). */
  setupTag?: SetupTag;
}

/** A scale-in: add `size` contracts to the OPEN position (same side) via a working
 *  market/limit/stop order that fills against the bar stream like an entry. */
export interface AddRequest {
  entryType: EntryType;
  entryPrice?: number;
  size: number;
  reason?: string;
}

interface PendingEntry extends BracketRequest {
  id: string;
  placedAt: number;
}

/** A working scale-in order resting against the open position. */
export interface WorkingAdd extends AddRequest {
  id: string;
  placedAt: number;
}

interface Position {
  id: string;
  side: Side;
  /** Running (remaining) net size. */
  size: number;
  /** Size-weighted average of ALL entry fills so far (moves as adds fill). */
  avgEntry: number;
  /** First entry's fill price and size — the 1R anchor; never rewritten by adds. */
  firstEntryPrice: number;
  initialSize: number;
  initialStop: number;
  stop: number;
  /** Convenience: the furthest remaining target price (NaN when no legs rest). */
  target: number;
  /** Remaining resting take-profit legs (attached full-cover target + any reduce
   *  limits the trader placed). */
  targets: TargetLeg[];
  level?: string;
  reason?: string;
  setupTag?: SetupTag;
  /** Objective confirmation flags stamped at the first entry (#10), null if unprovided. */
  confirmation?: ConfirmationFlags;
  fills: Fill[];
  /** Σ entry price×size and Σ entry size, for the running average entry. */
  entryNotional: number;
  entrySize: number;
  /** Σ exit price×size and Σ exit size, for the size-weighted average exit at close. */
  exitNotional: number;
  exitSize: number;
  /** The most recent exit's reason/method — the trade's headline exit at close. */
  lastExitReason: FillReason;
  lastExitMethod: FillMethod;
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
  /** The four objective confirmation flags present at the first entry (#10). */
  confirmation?: ConfirmationFlags;
  fills: Fill[];
  /** Size-weighted average entry across all adds. */
  avgEntry: number;
  /** Size-weighted average exit across all partial exits. */
  exitPrice: number;
  /** The final exit's reason/method (what took the position flat). */
  exitReason: FillReason;
  exitMethod: FillMethod;
  /** Total contracts traded (Σ entry sizes = Σ exit sizes at close). */
  size: number;
  initialStop: number;
  /** First entry's risk distance (|firstEntry − initialStop|) — the 1R anchor. */
  riskPoints: number;
  maePoints: number;
  mfePoints: number;
  pnlPoints: number;
  pnlUsd: number;
  commissionUsd: number;
  /** Net realized $ ÷ 1R$, where 1R = first-entry dollar risk (ADR-0007). */
  rMultiple: number;
  /** Number of entry fills / exit fills — surfaces scale-in/out at a glance. */
  entryCount: number;
  exitCount: number;
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
  private pendingAdds: WorkingAdd[] = [];
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

  /** Supply the confirmation-flag stamper, called the moment the first entry fills (#10). */
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
  /** The resting scale-in orders on the open position (draggable / cancelable). */
  get workingAdds(): readonly WorkingAdd[] {
    return this.pendingAdds;
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

  /** Place a bracket to open a position. One position at a time (single net
   *  position); once open, scale in with `addToPosition` and out with
   *  `placeReduceLimit` / `reducePosition`. */
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

  /** Scale in: rest a working add order against the OPEN position (same side).
   *  Fills against the bar stream like an entry, then merges into the position (new
   *  running size and average entry). Several may work at once. 1R is untouched —
   *  adds never rewrite the first-entry risk. Returns the order id. */
  addToPosition(add: AddRequest, now: number): string {
    if (!this.position) throw new Error("no open position to add to");
    if (add.size <= 0) throw new Error("size must be positive");
    if (add.entryType !== "market" && add.entryPrice === undefined) {
      throw new Error(`${add.entryType} add needs an entryPrice`);
    }
    const id = `a${++this.seq}`;
    this.now = now;
    this.pendingAdds.push({ ...add, id, placedAt: now });
    this.emit({ kind: "placed", t: now, orderId: id, req: this.addAsReq(add) });
    return id;
  }

  /** Scale out: rest a take-profit limit on the OPEN position for `size` contracts
   *  at `price` (a sell-limit for a long, buy-limit for a short). Fills only its own
   *  size, leaving the rest working — this is how TP1/TP2/runner are built (#11). */
  placeReduceLimit(price: number, size: number, now: number): void {
    if (!this.position) throw new Error("no open position to reduce");
    if (size <= 0) throw new Error("size must be positive");
    this.now = now;
    this.position.targets.push({ price, size, coversAll: false });
    this.refreshFurthestTarget();
  }

  cancelPending(): void {
    if (this.pending) {
      this.emit({ kind: "cancelled", t: this.now, orderId: this.pending.id });
    }
    this.pending = null;
  }

  /** Cancel a working scale-in add by id (the position itself is untouched). */
  cancelAdd(id: string): void {
    const i = this.pendingAdds.findIndex((a) => a.id === id);
    if (i >= 0) {
      this.emit({ kind: "cancelled", t: this.now, orderId: id });
      this.pendingAdds.splice(i, 1);
    }
  }

  /** Cancel a resting reduce-limit leg by index. Only reduce legs the trader placed
   *  are cancelable; the attached full-cover target is part of the bracket. */
  cancelTarget(index: number): void {
    const p = this.position;
    if (!p || index < 0 || index >= p.targets.length) return;
    if (p.targets[index].coversAll) return; // the attached target isn't a loose order
    p.targets.splice(index, 1);
    this.refreshFurthestTarget();
  }

  /** Move the live position's stop and/or furthest target (trail, break-even,
   *  tighten). `initialStop` is untouched, so R stays anchored to the first stop
   *  (CONTEXT). Takes effect on the next bar's adjudication — no same-bar cheat. */
  modifyBracket(next: { stop?: number; target?: number }): void {
    const p = this.position;
    if (!p) return;
    if (next.stop !== undefined) p.stop = next.stop;
    if (next.target !== undefined && p.targets.length) {
      p.targets[p.targets.length - 1].price = next.target;
      this.refreshFurthestTarget();
    }
  }

  /** Reprice one resting take-profit leg by its (stable) index (drag it on the
   *  chart, #11). Legs are never re-sorted, so an index addresses the same leg
   *  until it fills. */
  modifyTarget(index: number, price: number): void {
    const p = this.position;
    if (!p || index < 0 || index >= p.targets.length) return;
    p.targets[index].price = price;
    this.refreshFurthestTarget();
  }

  /** Reprice a working scale-in order by id (drag it on the chart, #11). */
  modifyAdd(id: string, price: number): void {
    const a = this.pendingAdds.find((o) => o.id === id);
    if (a && a.entryType !== "market") a.entryPrice = price;
  }

  /** Recompute the convenience furthest-target price after a leg moves/fills. */
  private refreshFurthestTarget(): void {
    const p = this.position!;
    if (!p.targets.length) {
      p.target = NaN;
      return;
    }
    p.target = p.targets.reduce(
      (acc, l) => (p.side === "long" ? Math.max(acc, l.price) : Math.min(acc, l.price)),
      p.side === "long" ? -Infinity : Infinity,
    );
  }

  /** Adjudicate one 1s bar in clock order. Entries/adds first, then exits —
   *  including an exit on the very bar an entry fills (pessimistic: a whipsaw can
   *  stop you out the same second you got in). */
  async onBar(bar: Sec1Bar): Promise<void> {
    this.now = bar.t;
    if (this.pending) this.tryEntry(bar);
    if (this.position && this.pendingAdds.length) this.tryAdds(bar);
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
    if (p.stop !== this.recordedStop || !Object.is(p.target, this.recordedTarget)) {
      this.recordedStop = p.stop;
      this.recordedTarget = p.target;
      this.emit({ kind: "stop_moved", t, orderId: p.id, stop: p.stop, target: p.target });
    }
  }

  /** Market-flatten the ENTIRE open position at the current bar. `reason`
   *  distinguishes a manual flatten from the forced 11:30 end-of-day auto-flatten. */
  flatten(bar: Sec1Bar, reason: FillReason = "flatten"): void {
    if (!this.position) return;
    this.reduceAtMarket(bar, this.position.size, reason);
  }

  /** Scale out manually: market-exit `size` contracts of the open position at the
   *  current bar (the position-panel partial close). Clamped to the running size;
   *  taking it to flat closes the trade. */
  reducePosition(size: number, bar: Sec1Bar): void {
    if (!this.position) return;
    if (size <= 0) throw new Error("size must be positive");
    this.reduceAtMarket(bar, Math.min(size, this.position.size), "flatten");
  }

  private reduceAtMarket(bar: Sec1Bar, size: number, reason: FillReason): void {
    const p = this.position!;
    const price = p.side === "long" ? bar.c - this.slip : bar.c + this.slip;
    this.recordExit(bar.t, price, size, reason, "clean");
  }

  // --- entries + adds -------------------------------------------------------
  private tryEntry(bar: Sec1Bar): void {
    const e = this.pending!;
    const price = this.fillPrice(e.side, e.entryType, e.entryPrice, bar);
    if (price === null) return;

    const fill: Fill = { t: bar.t, price, size: e.size, reason: "entry", method: "clean" };
    const targets = this.legsFor(e);
    this.position = {
      id: e.id,
      side: e.side,
      size: e.size,
      avgEntry: price,
      firstEntryPrice: price,
      initialSize: e.size,
      initialStop: e.stop,
      stop: e.stop,
      target: NaN,
      targets,
      level: e.level,
      reason: e.reason,
      setupTag: e.setupTag,
      fills: [fill],
      entryNotional: price * e.size,
      entrySize: e.size,
      exitNotional: 0,
      exitSize: 0,
      lastExitReason: "flatten",
      lastExitMethod: "clean",
      maePoints: 0,
      mfePoints: 0,
      openedAt: bar.t,
    };
    this.refreshFurthestTarget();
    // Stamp the objective confirmation flags from the market state at the fill (#10).
    if (this.confirmationProvider) {
      this.position.confirmation =
        this.confirmationProvider({ side: e.side, entryPrice: price, t: bar.t }) ?? undefined;
    }
    this.pending = null;
    // Seed the coalesce baseline so the opening bracket isn't mistaken for a move.
    this.recordedStop = e.stop;
    this.recordedTarget = this.position.target;
    this.emit({ kind: "fill", t: bar.t, orderId: this.position.id, fill });
    this.updateExcursions(bar); // count the entry bar's excursion too
  }

  private tryAdds(bar: Sec1Bar): void {
    const p = this.position!;
    // Iterate a snapshot; fills mutate the working list.
    for (const a of [...this.pendingAdds]) {
      const price = this.fillPrice(p.side, a.entryType, a.entryPrice, bar);
      if (price === null) continue;
      const fill: Fill = { t: bar.t, price, size: a.size, reason: "entry", method: "clean" };
      p.fills.push(fill);
      p.entryNotional += price * a.size;
      p.entrySize += a.size;
      p.size += a.size;
      p.avgEntry = p.entryNotional / p.entrySize; // 1R stays anchored to firstEntryPrice
      this.pendingAdds = this.pendingAdds.filter((o) => o.id !== a.id);
      this.emit({ kind: "fill", t: bar.t, orderId: a.id, fill });
    }
  }

  /** The fill price for an entry/add of the given type at this bar, or null if it
   *  didn't trigger. Market = next-bar open ± slip; limit = clean trade-through;
   *  stop-entry = level ± slip. */
  private fillPrice(
    side: Side,
    type: EntryType,
    entryPrice: number | undefined,
    bar: Sec1Bar,
  ): number | null {
    if (type === "market") return side === "long" ? bar.o + this.slip : bar.o - this.slip;
    if (type === "limit") {
      if (side === "long" && bar.l <= entryPrice!) return entryPrice!;
      if (side === "short" && bar.h >= entryPrice!) return entryPrice!;
      return null;
    }
    // Stop-entry: buy stop above, sell stop below. Fills with slippage.
    if (side === "long" && bar.h >= entryPrice!) return entryPrice! + this.slip;
    if (side === "short" && bar.l <= entryPrice!) return entryPrice! - this.slip;
    return null;
  }

  // --- exits ----------------------------------------------------------------
  private async tryExit(bar: Sec1Bar): Promise<void> {
    const p = this.position!;
    const stopHit = p.side === "long" ? bar.l <= p.stop : bar.h >= p.stop;
    const touched = this.touchedTargets(bar, p);

    if (stopHit && touched.length) {
      await this.resolveStraddle(bar); // true tick order if available, else pessimistic
    } else if (stopHit) {
      this.exitAtStop(bar, "clean"); // full stop-out of the remaining size
    } else if (touched.length) {
      this.takeTargets(bar.t, touched, "clean");
    }
  }

  /** Remaining target legs whose price this bar's range reached (nearest first). */
  private touchedTargets(bar: Sec1Bar, p: Position): TargetLeg[] {
    return p.targets.filter((leg) =>
      p.side === "long" ? bar.h >= leg.price : bar.l <= leg.price,
    );
  }

  /** Fill each touched profit leg at its price, clamped to the running size. A
   *  clean (no stop) bar can clear several legs in one second; order among them
   *  doesn't change realized $. Emptying the position closes the trade. */
  private takeTargets(t: number, legs: TargetLeg[], method: FillMethod): void {
    for (const leg of legs) {
      if (!this.position) break; // an earlier leg already took it flat
      const size = this.legFillSize(leg);
      this.removeLeg(leg);
      this.recordExit(t, leg.price, size, "target", method);
    }
  }

  /** How many contracts a leg fills: a full-cover target takes the whole remaining
   *  position (adds included); an ordinary reduce-limit takes only its own size. */
  private legFillSize(leg: TargetLeg): number {
    const p = this.position!;
    return leg.coversAll ? p.size : Math.min(leg.size, p.size);
  }

  /** A second whose range touched both the stop and a target. Walk the true prints
   *  when available and honour their order (a target can print, taking a partial,
   *  before the stop takes the rest); fall back to pessimistic (whole remaining
   *  stopped out, stop first) when no ticks are available (ADR-0004, SPEC §4). */
  private async resolveStraddle(bar: Sec1Bar): Promise<void> {
    if (this.resolver) {
      const ticks = await this.resolver(bar.t);
      if (ticks && ticks.length && this.walkTicks(bar.t, ticks)) return;
    }
    this.exitAtStop(bar, "pessimistic");
  }

  /** Replay the prints in order against the remaining stop + target legs, filling
   *  whichever level each print crosses (tick-true). Returns true if it resolved
   *  the straddle (stop taken, or every leg cleared); false if nothing decisive
   *  crossed so the caller should fall back to pessimistic. */
  private walkTicks(t: number, ticks: readonly number[]): boolean {
    for (const px of ticks) {
      const p = this.position;
      if (!p) return true; // legs cleared the position
      const long = p.side === "long";
      if (long ? px <= p.stop : px >= p.stop) {
        this.exitAtStop({ t } as Sec1Bar, "tick-true"); // stop takes the rest
        return true;
      }
      const leg = p.targets.find((l) => (long ? px >= l.price : px <= l.price));
      if (leg) {
        const size = this.legFillSize(leg);
        this.removeLeg(leg);
        this.recordExit(t, leg.price, size, "target", "tick-true");
      }
    }
    // Prints crossed some targets but never the stop: the position is legitimately
    // still open (or was fully cleared by legs). Resolved iff no longer open.
    return this.position === null;
  }

  private removeLeg(leg: TargetLeg): void {
    const p = this.position!;
    const i = p.targets.indexOf(leg);
    if (i >= 0) p.targets.splice(i, 1);
    this.refreshFurthestTarget();
  }

  private exitAtStop(bar: Sec1Bar, method: FillMethod): void {
    const p = this.position!;
    const price = p.side === "long" ? p.stop - this.slip : p.stop + this.slip;
    this.recordExit(bar.t, price, p.size, "stop", method);
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

  /** Record one exit fill (partial or full). Accrues the size-weighted exit and
   *  finalizes the Trade once the running size returns to flat. */
  private recordExit(
    t: number,
    exitPrice: number,
    size: number,
    reason: FillReason,
    method: FillMethod,
  ): void {
    const p = this.position!;
    const exitFill: Fill = { t, price: exitPrice, size, reason, method };
    p.fills.push(exitFill);
    p.exitNotional += exitPrice * size;
    p.exitSize += size;
    p.size -= size;
    p.lastExitReason = reason;
    p.lastExitMethod = method;
    this.emit({ kind: "fill", t, orderId: p.id, fill: exitFill });
    if (p.size <= 1e-9) this.finalize(t);
  }

  /** The position is flat: build the sealed Trade from the accumulated fills. */
  private finalize(t: number): void {
    const p = this.position!;
    const { pointValue } = this.contract;
    const avgEntry = p.entryNotional / p.entrySize;
    const avgExit = p.exitNotional / p.exitSize;
    const pnlPoints = p.side === "long" ? avgExit - avgEntry : avgEntry - avgExit;
    // Commission is one side per fill; entries + exits balance to 2× total size.
    const totalContracts = p.fills.reduce((s, f) => s + f.size, 0);
    const commissionUsd = this.config.commissionPerContract * totalContracts;
    const pnlUsd = pnlPoints * pointValue * p.entrySize - commissionUsd;
    // 1R anchors to the FIRST entry's risk (ADR-0007) — adds never rewrite it.
    const riskPoints = Math.abs(p.firstEntryPrice - p.initialStop);
    const oneRusd = riskPoints * pointValue * p.initialSize;
    const rMultiple = oneRusd > 0 ? pnlUsd / oneRusd : 0;
    const entryCount = p.fills.filter((f) => f.reason === "entry").length;

    const trade: Trade = {
      id: p.id,
      side: p.side,
      level: p.level,
      reason: p.reason,
      setupTag: p.setupTag,
      confirmation: p.confirmation,
      fills: p.fills,
      avgEntry,
      exitPrice: avgExit,
      exitReason: p.lastExitReason,
      exitMethod: p.lastExitMethod,
      size: p.entrySize,
      initialStop: p.initialStop,
      riskPoints,
      maePoints: p.maePoints,
      mfePoints: p.mfePoints,
      pnlPoints,
      pnlUsd,
      commissionUsd,
      rMultiple,
      entryCount,
      exitCount: p.fills.length - entryCount,
      openedAt: p.openedAt,
      closedAt: t,
    };
    this._trades.push(trade);
    this.position = null;
    this.pendingAdds = []; // working adds can't outlive the position
    this.recordedStop = NaN;
    this.recordedTarget = NaN;
    this.emit({ kind: "closed", t, orderId: trade.id, trade });
    this.onTrade(trade);
  }

  /** The resting legs a bracket opens with: an optional full-cover target, plus any
   *  pre-declared staged legs (fixed size). Ordered nearest-to-entry (by side). */
  private legsFor(req: BracketRequest): TargetLeg[] {
    const legs: TargetLeg[] = [];
    if (req.targets && req.targets.length) {
      for (const l of req.targets) legs.push({ ...l, coversAll: false });
    } else if (req.target !== undefined) {
      legs.push({ price: req.target, size: req.size, coversAll: true });
    }
    legs.sort((a, b) => (req.side === "long" ? a.price - b.price : b.price - a.price));
    return legs;
  }

  private addAsReq(a: AddRequest): BracketRequest {
    const p = this.position!;
    return {
      side: p.side,
      entryType: a.entryType,
      entryPrice: a.entryPrice,
      stop: p.stop,
      target: Number.isFinite(p.target) ? p.target : undefined,
      size: a.size,
      reason: a.reason ?? "add",
    };
  }

  private validateBracket(req: BracketRequest): void {
    if (req.entryType !== "market" && req.entryPrice === undefined) {
      throw new Error(`${req.entryType} entry needs an entryPrice`);
    }
    const legs = this.legsFor(req);
    // Stop below every target for longs (and mirror for shorts).
    const bad = legs.some((l) => (req.side === "long" ? req.stop >= l.price : req.stop <= l.price));
    if (bad) {
      throw new Error(
        req.side === "long" ? "long bracket needs stop < target" : "short bracket needs stop > target",
      );
    }
  }
}
