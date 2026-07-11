import type { ChartView } from "../chart/chartView";
import type { Side } from "../engine/fillEngine";

export interface DraftBracket {
  side: Side;
  entry: number;
  stop: number;
  target: number;
}

type Handle = "entry" | "stop" | "target";

/**
 * On-chart bracket placement: three draggable horizontal lines (entry/stop/
 * target) rendered as an HTML overlay on the chart, with a live R:R readout.
 * Lightweight Charts has no native order tool (that's TradingView's proprietary
 * library), so this is built on its price↔pixel conversion. Only the lines
 * capture the mouse, so the chart stays pannable while editing.
 */
export class BracketEditor {
  private overlay: HTMLDivElement;
  private lines: Record<Handle, HTMLDivElement>;
  private raf = 0;
  private draft: DraftBracket | null = null;
  private dragging: Handle | null = null;
  private mode: "place" | "place-entry" | "manage" | null = null;
  private draggable = new Set<Handle>();
  /** Side chosen for a click-to-place entry, before the entry click lands. */
  private pendingSide: Side = "long";
  private placeCleanup: (() => void) | null = null;
  private onChangeCb: (d: DraftBracket | null) => void = () => {};

  constructor(
    private chart: ChartView,
    private tick: number,
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "bracket-overlay";
    this.lines = {
      target: this.makeLine("target", "#26a69a"),
      entry: this.makeLine("entry", "#3b82f6"),
      stop: this.makeLine("stop", "#ef5350"),
    };
    chart.element.style.position = "relative";
    chart.element.appendChild(this.overlay);
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

  /** Seed a bracket around `entry` and enter placement with `draggable` handles
   *  editable. Pins the price scale so the lines don't drift while aiming. */
  private seedPlace(side: Side, entry: number, draggable: Set<Handle>): void {
    const dir = side === "long" ? 1 : -1;
    this.begin("place", draggable, {
      side,
      entry: this.round(entry),
      stop: this.round(entry - 30 * dir),
      target: this.round(entry + 60 * dir),
    });
    this.chart.setPriceAutoScale(false);
  }

  /** PLACEMENT (drag style): all three lines draggable from a seed price. */
  start(side: Side, entry: number): void {
    this.seedPlace(side, entry, new Set(["entry", "stop", "target"]));
  }

  /** PLACEMENT (market): entry is fixed at the current price; drag stop/target only. */
  startMarket(side: Side, current: number): void {
    this.seedPlace(side, current, new Set(["stop", "target"]));
  }

  /** PLACEMENT (click style): a ghost entry line tracks the cursor; the next click on
   *  the chart sets the entry, then stop/target appear as draggable bars. Escape
   *  cancels. Entry stays fixed after the click. */
  startClickPlace(side: Side): void {
    this.pendingSide = side;
    this.mode = "place-entry";
    this.overlay.classList.add("active");
    this.chart.setPriceAutoScale(false);
    const el = this.chart.element;
    const entryLine = this.lines.entry;
    this.lines.stop.style.display = "none";
    this.lines.target.style.display = "none";
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
      this.seedPlace(this.pendingSide, entry, new Set(["stop", "target"]));
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

  /** MANAGEMENT: attach to a LIVE position; entry is fixed, stop/target draggable
   *  (trail, break-even, tighten). Autoscale stays live since the clock is running. */
  manage(side: Side, entry: number, stop: number, target: number): void {
    this.begin("manage", new Set(["stop", "target"]), {
      side,
      entry: this.round(entry),
      stop: this.round(stop),
      target: this.round(target),
    });
  }

  private begin(mode: "place" | "manage", draggable: Set<Handle>, draft: DraftBracket): void {
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
    // Flip stop/target across the entry so the geometry stays valid.
    const { entry } = this.draft;
    const dir = side === "long" ? 1 : -1;
    this.draft.side = side;
    this.draft.stop = this.round(entry - Math.abs(entry - this.draft.stop) * dir);
    this.draft.target = this.round(entry + Math.abs(this.draft.target - entry) * dir);
    this.onChangeCb(this.draft);
  }

  cancel(): void {
    this.clearPlaceEntry(); // drop any in-flight entry-click listeners
    this.draft = null;
    this.dragging = null;
    this.mode = null;
    this.draggable.clear();
    this.overlay.classList.remove("active");
    for (const h of ["entry", "stop", "target"] as Handle[]) this.lines[h].style.display = "none";
    this.chart.setPriceAutoScale(true); // restore live autoscale
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // --- internals ------------------------------------------------------------
  private makeLine(handle: Handle, color: string): HTMLDivElement {
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

  private beginDrag(e: PointerEvent, handle: Handle): void {
    if (!this.draft || !this.draggable.has(handle)) return;
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
    const stopAnchor = this.mode === "place" ? d.entry : d.target;
    const targetAnchor = this.mode === "place" ? d.entry : d.stop;

    if (this.dragging === "entry") {
      const hi = long ? d.target - tk : d.stop - tk;
      const lo = long ? d.stop + tk : d.target + tk;
      d.entry = Math.min(Math.max(p, lo), hi);
    } else if (this.dragging === "stop") {
      d.stop = long ? Math.min(p, stopAnchor - tk) : Math.max(p, stopAnchor + tk);
    } else {
      d.target = long ? Math.max(p, targetAnchor + tk) : Math.min(p, targetAnchor - tk);
    }
    this.onChangeCb(this.draft);
  }

  private loop = (): void => {
    if (!this.draft) return;
    this.position("entry", this.draft.entry);
    this.position("stop", this.draft.stop);
    this.position("target", this.draft.target);
    this.raf = requestAnimationFrame(this.loop);
  };

  private position(handle: Handle, price: number): void {
    const line = this.lines[handle];
    const y = this.chart.priceToY(price);
    if (y === null) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.top = `${y}px`;
    const d = this.draft!;
    const risk = Math.abs(d.entry - d.stop);
    const rr = risk > 0 ? Math.abs(d.target - d.entry) / risk : 0;
    const label = line.firstChild as HTMLSpanElement;
    const placing = this.mode === "place";
    if (handle === "entry") {
      label.textContent = placing
        ? `entry ${price.toFixed(2)} · R:R ${rr.toFixed(2)}`
        : `entry ${price.toFixed(2)} (filled)`;
    } else if (handle === "stop") {
      label.textContent = placing ? `stop ${price.toFixed(2)} · -1R` : `stop ${price.toFixed(2)}`;
    } else {
      label.textContent = placing
        ? `target ${price.toFixed(2)} · +${rr.toFixed(2)}R`
        : `target ${price.toFixed(2)}`;
    }
  }

  private round(p: number): number {
    return Math.round(p / this.tick) * this.tick;
  }
}
