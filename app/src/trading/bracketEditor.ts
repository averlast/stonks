import type { ChartView } from "../chart/chartView";
import type { Side } from "../engine/fillEngine";

/** One staged profit-taking leg placed on the chart: exit `size` contracts at
 *  `price` (TP1 / TP2 / Runner — #11). A plain bracket is a single full-size leg. */
export interface DraftLeg {
  price: number;
  size: number;
}

export interface DraftBracket {
  side: Side;
  entry: number;
  stop: number;
  /** Staged scale-out legs, in placement order (TP1, TP2, …, Runner). */
  targets: DraftLeg[];
}

/** Which line the pointer grabbed: entry, stop, or the target leg at `index`. */
type Handle =
  | { kind: "entry" }
  | { kind: "stop" }
  | { kind: "target"; index: number };

/**
 * On-chart bracket placement: draggable horizontal lines (entry / stop / one or
 * more staged targets) rendered as an HTML overlay on the chart, with live R:R
 * readouts. Lightweight Charts has no native order tool (that's TradingView's
 * proprietary library), so this is built on its price↔pixel conversion. Only the
 * lines capture the mouse, so the chart stays pannable while editing.
 *
 * Targets are staged (TP1/TP2/Runner, #11): the caller supplies a list of leg
 * sizes, each drawn as its own draggable line; on arm they become the bracket's
 * `targets[]`. A single leg is the plain one-target case.
 */
export class BracketEditor {
  private overlay: HTMLDivElement;
  private entryLine: HTMLDivElement;
  private stopLine: HTMLDivElement;
  /** A ghost line for single-price click placement of an in-position order. */
  private ghostLine: HTMLDivElement;
  private pickCleanup: (() => void) | null = null;
  /** One line per target leg, rebuilt whenever the leg count changes. */
  private targetLines: HTMLDivElement[] = [];
  private raf = 0;
  private draft: DraftBracket | null = null;
  private dragging: Handle | null = null;
  private mode: "place" | "place-entry" | "manage" | null = null;
  private draggable = new Set<"entry" | "stop" | "target">();
  /** Side + leg plan chosen for a click-to-place entry, before the click lands. */
  private pendingSide: Side = "long";
  private pendingLegs: number[] = [1];
  private placeCleanup: (() => void) | null = null;
  private onChangeCb: (d: DraftBracket | null) => void = () => {};

  constructor(
    private chart: ChartView,
    private tick: number,
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "bracket-overlay";
    this.entryLine = this.makeLine("#3b82f6", { kind: "entry" });
    this.stopLine = this.makeLine("#ef5350", { kind: "stop" });
    this.ghostLine = document.createElement("div");
    this.ghostLine.className = "bracket-line ghost";
    this.ghostLine.style.setProperty("--c", "#eab308");
    this.ghostLine.style.display = "none";
    this.ghostLine.appendChild(document.createElement("span")).className = "bracket-label";
    this.overlay.appendChild(this.ghostLine);
    chart.element.style.position = "relative";
    chart.element.appendChild(this.overlay);
  }

  /** Whether a single-price click placement is currently armed. */
  get picking(): boolean {
    return this.pickCleanup !== null;
  }

  /** Arm single-price click placement: a ghost line labelled `label` tracks the
   *  cursor; the next click on the chart calls `onPick(price)` and disarms; Escape
   *  cancels. Coexists with an active manage overlay (used to drop an in-position
   *  order at a level, #11). */
  pickPrice(label: string, onPick: (price: number) => void): void {
    this.cancelPick();
    this.overlay.classList.add("active");
    const el = this.chart.element;
    const line = this.ghostLine;
    let price = 0;
    const yOf = (ev: PointerEvent | MouseEvent): number =>
      ev.clientY - el.getBoundingClientRect().top;
    const move = (ev: PointerEvent): void => {
      const y = yOf(ev);
      const p = this.chart.yToPrice(y);
      if (p === null) return;
      price = this.round(p);
      line.style.display = "block";
      line.style.top = `${y}px`;
      (line.firstChild as HTMLSpanElement).textContent = `${label} ${price.toFixed(2)} · click`;
    };
    const set = (ev: MouseEvent): void => {
      const p = this.chart.yToPrice(yOf(ev));
      if (p === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      const picked = this.round(p);
      this.cancelPick();
      onPick(picked);
    };
    const key = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") this.cancelPick();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("click", set);
    window.addEventListener("keydown", key);
    this.pickCleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("click", set);
      window.removeEventListener("keydown", key);
      line.style.display = "none";
    };
  }

  cancelPick(): void {
    this.pickCleanup?.();
    this.pickCleanup = null;
  }

  get active(): boolean {
    return this.draft !== null || this.mode === "place-entry";
  }
  get editMode(): "place" | "place-entry" | "manage" | null {
    return this.mode;
  }
  get value(): DraftBracket | null {
    return this.draft;
  }
  onChange(cb: (d: DraftBracket | null) => void): void {
    this.onChangeCb = cb;
  }

  /** Default target prices for `n` legs, spread from ~half to the full seed reach
   *  (30 → 60 pts) so TP1 is nearer than the runner; the trader then drags each. */
  private defaultReach(n: number): number[] {
    if (n <= 1) return [60];
    return Array.from({ length: n }, (_, i) => 30 + (30 * i) / (n - 1));
  }

  /** Seed a bracket around `entry` with one target line per leg size and enter
   *  placement with `draggable` handle kinds editable. Pins the price scale so the
   *  lines don't drift while aiming. */
  private seedPlace(
    side: Side,
    entry: number,
    draggable: Set<"entry" | "stop" | "target">,
    legSizes: number[],
  ): void {
    const dir = side === "long" ? 1 : -1;
    const reach = this.defaultReach(legSizes.length);
    this.setTargetCount(legSizes.length);
    this.begin("place", draggable, {
      side,
      entry: this.round(entry),
      stop: this.round(entry - 30 * dir),
      targets: legSizes.map((size, i) => ({
        price: this.round(entry + reach[i] * dir),
        size,
      })),
    });
    this.chart.setPriceAutoScale(false);
  }

  /** PLACEMENT (drag style): entry, stop, and every target draggable from a seed. */
  start(side: Side, entry: number, legSizes: number[] = [1]): void {
    this.seedPlace(side, entry, new Set(["entry", "stop", "target"]), legSizes);
  }

  /** PLACEMENT (market): entry fixed at the current price; drag stop/targets only. */
  startMarket(side: Side, current: number, legSizes: number[] = [1]): void {
    this.seedPlace(side, current, new Set(["stop", "target"]), legSizes);
  }

  /** PLACEMENT (click style): a ghost entry line tracks the cursor; the next click
   *  on the chart sets the entry, then stop/targets appear draggable. Escape cancels. */
  startClickPlace(side: Side, legSizes: number[] = [1]): void {
    this.pendingSide = side;
    this.pendingLegs = legSizes;
    this.mode = "place-entry";
    this.overlay.classList.add("active");
    this.chart.setPriceAutoScale(false);
    this.setTargetCount(0); // no targets until the entry is placed
    const el = this.chart.element;
    const entryLine = this.entryLine;
    this.stopLine.style.display = "none";
    let price = 0;

    const paint = (y: number): void => {
      entryLine.style.display = "block";
      entryLine.style.top = `${y}px`;
      (entryLine.firstChild as HTMLSpanElement).textContent =
        `entry ${price.toFixed(2)} · click to set`;
    };
    const yOf = (ev: PointerEvent): number => ev.clientY - el.getBoundingClientRect().top;
    const move = (ev: PointerEvent): void => {
      const y = yOf(ev);
      const p = this.chart.yToPrice(y);
      if (p === null) return;
      price = this.round(p);
      paint(y);
    };
    const set = (ev: PointerEvent): void => {
      const p = this.chart.yToPrice(yOf(ev));
      if (p === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      const entry = this.round(p);
      this.clearPlaceEntry();
      // Entry stays draggable after the click — the click just seeds it; you can
      // still nudge it (along with stop/target) before arming.
      this.seedPlace(this.pendingSide, entry, new Set(["entry", "stop", "target"]), this.pendingLegs);
    };
    const key = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") this.cancel();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("click", set);
    window.addEventListener("keydown", key);
    this.placeCleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("click", set);
      window.removeEventListener("keydown", key);
    };
    this.onChangeCb(null); // no draft to arm until the entry is clicked
  }

  private clearPlaceEntry(): void {
    this.placeCleanup?.();
    this.placeCleanup = null;
  }

  /** MANAGEMENT: attach to a LIVE position; entry fixed, stop + every remaining
   *  staged target draggable (trail, break-even, tighten, retarget TP1/TP2/Runner,
   *  #11). The caller re-attaches with the current legs whenever one fills, so the
   *  overlay always mirrors the engine. Autoscale stays live. */
  manage(side: Side, entry: number, stop: number, targets: DraftLeg[]): void {
    this.setTargetCount(targets.length);
    this.begin("manage", new Set(["stop", "target"]), {
      side,
      entry: this.round(entry),
      stop: this.round(stop),
      targets: targets.map((l) => ({ price: this.round(l.price), size: l.size })),
    });
  }

  private begin(
    mode: "place" | "manage",
    draggable: Set<"entry" | "stop" | "target">,
    draft: DraftBracket,
  ): void {
    this.mode = mode;
    this.draggable = draggable;
    this.draft = draft;
    this.overlay.classList.add("active");
    if (this.raf === 0) this.loop();
    this.onChangeCb(this.draft);
  }

  setSide(side: Side): void {
    if (this.mode === "place-entry") {
      this.pendingSide = side; // the entry click hasn't landed yet
      return;
    }
    if (this.mode !== "place" || !this.draft || this.draft.side === side) return;
    // Flip stop + every target across the entry so the geometry stays valid.
    const { entry } = this.draft;
    const dir = side === "long" ? 1 : -1;
    this.draft.side = side;
    this.draft.stop = this.round(entry - Math.abs(entry - this.draft.stop) * dir);
    for (const leg of this.draft.targets) {
      leg.price = this.round(entry + Math.abs(leg.price - entry) * dir);
    }
    this.onChangeCb(this.draft);
  }

  cancel(): void {
    this.clearPlaceEntry(); // drop any in-flight entry-click listeners
    this.draft = null;
    this.dragging = null;
    this.mode = null;
    this.draggable.clear();
    this.overlay.classList.remove("active");
    this.entryLine.style.display = "none";
    this.stopLine.style.display = "none";
    this.setTargetCount(0);
    this.chart.setPriceAutoScale(true); // restore live autoscale
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // --- internals ------------------------------------------------------------
  private makeLine(color: string, handle: Handle): HTMLDivElement {
    const line = document.createElement("div");
    line.className = "bracket-line";
    line.style.setProperty("--c", color);
    const label = document.createElement("span");
    label.className = "bracket-label";
    line.appendChild(label);
    line.addEventListener("pointerdown", (e) => this.beginDrag(e, handle));
    this.overlay.appendChild(line);
    return line;
  }

  /** Grow/shrink the pool of target lines to exactly `n`, rewiring each to its
   *  index so a drag knows which leg it moves. */
  private setTargetCount(n: number): void {
    while (this.targetLines.length < n) {
      const idx = this.targetLines.length;
      this.targetLines.push(this.makeLine("#26a69a", { kind: "target", index: idx }));
    }
    while (this.targetLines.length > n) {
      const line = this.targetLines.pop()!;
      line.remove();
    }
  }

  private beginDrag(e: PointerEvent, handle: Handle): void {
    if (!this.draft || !this.draggable.has(handle.kind)) return;
    e.preventDefault();
    this.dragging = handle;
    const move = (ev: PointerEvent) => this.onDrag(ev);
    const up = () => {
      this.dragging = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private onDrag(e: PointerEvent): void {
    if (!this.draft || !this.dragging) return;
    const rect = this.chart.element.getBoundingClientRect();
    const price = this.chart.yToPrice(e.clientY - rect.top);
    if (price === null) return;
    const p = this.round(price);
    const d = this.draft;
    const long = d.side === "long";
    const tk = this.tick;
    // Placement keeps the stop on the losing side of entry; management only keeps
    // stop/target from crossing, so the stop can trail past entry to lock profit.
    const nearestTarget = d.targets.reduce(
      (acc, l) => (long ? Math.min(acc, l.price) : Math.max(acc, l.price)),
      long ? Infinity : -Infinity,
    );
    const stopAnchor = this.mode === "place" ? d.entry : nearestTarget;
    const targetAnchor = this.mode === "place" ? d.entry : d.stop;

    if (this.dragging.kind === "entry") {
      const hi = long ? nearestTarget - tk : d.stop - tk;
      const lo = long ? d.stop + tk : nearestTarget + tk;
      d.entry = Math.min(Math.max(p, lo), hi);
    } else if (this.dragging.kind === "stop") {
      d.stop = long ? Math.min(p, stopAnchor - tk) : Math.max(p, stopAnchor + tk);
    } else {
      const leg = d.targets[this.dragging.index];
      if (leg) leg.price = long ? Math.max(p, targetAnchor + tk) : Math.min(p, targetAnchor - tk);
    }
    this.onChangeCb(this.draft);
  }

  private loop = (): void => {
    if (!this.draft) return;
    this.positionLine(this.entryLine, "entry", this.draft.entry, 0);
    this.positionLine(this.stopLine, "stop", this.draft.stop, 0);
    for (let i = 0; i < this.draft.targets.length; i++) {
      this.positionLine(this.targetLines[i], "target", this.draft.targets[i].price, i);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private positionLine(
    line: HTMLDivElement | undefined,
    kind: "entry" | "stop" | "target",
    price: number,
    index: number,
  ): void {
    if (!line) return;
    const y = this.chart.priceToY(price);
    if (y === null) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.top = `${y}px`;
    const d = this.draft!;
    const risk = Math.abs(d.entry - d.stop);
    const rr = risk > 0 ? Math.abs(price - d.entry) / risk : 0;
    const label = line.firstChild as HTMLSpanElement;
    const placing = this.mode === "place";
    if (kind === "entry") {
      label.textContent = placing
        ? `entry ${price.toFixed(2)} · R:R ${rr.toFixed(2)}`
        : `entry ${price.toFixed(2)} (filled)`;
    } else if (kind === "stop") {
      label.textContent = placing ? `stop ${price.toFixed(2)} · -1R` : `stop ${price.toFixed(2)}`;
    } else {
      const leg = d.targets[index];
      const name = this.legName(index, d.targets.length);
      const qty = leg && leg.size > 0 ? ` ×${leg.size}` : "";
      label.textContent = placing
        ? `${name}${qty} ${price.toFixed(2)} · +${rr.toFixed(2)}R`
        : `${name}${qty} ${price.toFixed(2)}`;
    }
  }

  /** TP1 / TP2 / … / Runner naming for a leg, or plain "target" when there's one. */
  private legName(index: number, count: number): string {
    if (count <= 1) return "target";
    if (index === count - 1) return "Runner";
    return `TP${index + 1}`;
  }

  private round(p: number): number {
    return Math.round(p / this.tick) * this.tick;
  }
}
