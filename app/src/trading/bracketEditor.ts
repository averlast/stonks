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
    return this.draft !== null;
  }
  get value(): DraftBracket | null {
    return this.draft;
  }
  onChange(cb: (d: DraftBracket | null) => void): void {
    this.onChangeCb = cb;
  }

  /** Begin editing a bracket seeded around `entry` for the given side. */
  start(side: Side, entry: number): void {
    const dir = side === "long" ? 1 : -1;
    this.draft = {
      side,
      entry: this.round(entry),
      stop: this.round(entry - 30 * dir),
      target: this.round(entry + 60 * dir),
    };
    this.overlay.classList.add("active");
    this.loop();
    this.onChangeCb(this.draft);
  }

  setSide(side: Side): void {
    if (!this.draft || this.draft.side === side) return;
    // Flip stop/target across the entry so the geometry stays valid.
    const { entry } = this.draft;
    const dir = side === "long" ? 1 : -1;
    this.draft.side = side;
    this.draft.stop = this.round(entry - Math.abs(entry - this.draft.stop) * dir);
    this.draft.target = this.round(entry + Math.abs(this.draft.target - entry) * dir);
    this.onChangeCb(this.draft);
  }

  cancel(): void {
    this.draft = null;
    this.dragging = null;
    this.overlay.classList.remove("active");
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
    if (!this.draft) return;
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
    const longish = d.side === "long";

    if (this.dragging === "entry") {
      const hi = longish ? d.target - this.tick : d.stop - this.tick;
      const lo = longish ? d.stop + this.tick : d.target + this.tick;
      d.entry = Math.min(Math.max(p, lo), hi);
    } else if (this.dragging === "stop") {
      d.stop = longish ? Math.min(p, d.entry - this.tick) : Math.max(p, d.entry + this.tick);
    } else {
      d.target = longish ? Math.max(p, d.entry + this.tick) : Math.min(p, d.entry - this.tick);
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
    if (handle === "entry") label.textContent = `entry ${price.toFixed(2)} · R:R ${rr.toFixed(2)}`;
    else if (handle === "stop") label.textContent = `stop ${price.toFixed(2)} · -1R`;
    else label.textContent = `target ${price.toFixed(2)} · +${rr.toFixed(2)}R`;
  }

  private round(p: number): number {
    return Math.round(p / this.tick) * this.tick;
  }
}
