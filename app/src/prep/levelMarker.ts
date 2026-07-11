import type { ChartView } from "../chart/chartView";

/** One blind mark the trader is placing during Prep. */
interface Mark {
  id: number;
  price: number;
}

/**
 * The Prep marking tool (#7): draggable horizontal lines the trader places on the
 * prior-day chart to mark where they believe the pre-session levels are. Built on
 * the same overlay/price↔pixel approach as `bracketEditor.ts` (Lightweight Charts
 * has no native level tool), but holds an arbitrary number of independent lines.
 *
 * The eval is practising the *ritual* of marking, so lines are freely draggable
 * against the visible prior-day/overnight bars; on Commit the tool locks and the
 * true levels are revealed separately (ChartView.setLevelLines).
 */
export class LevelMarker {
  private overlay: HTMLDivElement;
  private marks: Mark[] = [];
  private lines = new Map<number, HTMLDivElement>();
  private seq = 0;
  private raf = 0;
  private dragging: number | null = null;
  private enabled = true;
  private onChangeCb: () => void = () => {};

  constructor(
    private chart: ChartView,
    private tick: number,
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "level-overlay";
    chart.element.style.position = "relative";
    chart.element.appendChild(this.overlay);
  }

  /** Fires on add / drag / remove, so the panel can re-render the marks list. */
  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  /** Current marks in placement order (id + price). */
  get marksList(): readonly Mark[] {
    return this.marks;
  }
  /** Just the marked prices (what the commit freezes). */
  get prices(): number[] {
    return this.marks.map((m) => m.price);
  }

  /** Begin drawing: show the overlay and start the positioning loop. */
  start(): void {
    this.overlay.classList.add("active");
    if (this.raf === 0) this.loop();
  }

  /** Drop a new draggable mark at `price` (seeded near the visible mid). */
  add(price: number): void {
    if (!this.enabled) return;
    const id = ++this.seq;
    this.marks.push({ id, price: this.round(price) });
    this.lines.set(id, this.makeLine(id));
    this.onChangeCb();
  }

  remove(id: number): void {
    if (!this.enabled) return;
    this.marks = this.marks.filter((m) => m.id !== id);
    const line = this.lines.get(id);
    if (line) {
      line.remove();
      this.lines.delete(id);
    }
    this.onChangeCb();
  }

  /** Freeze the marks (post-commit): no more add/drag/remove. */
  disable(): void {
    this.enabled = false;
    for (const l of this.lines.values()) l.classList.add("locked");
  }

  /** Tear down the overlay (leaving Prep for the attempt). */
  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.overlay.remove();
  }

  // --- internals ------------------------------------------------------------
  private makeLine(id: number): HTMLDivElement {
    const line = document.createElement("div");
    line.className = "level-line";
    const label = document.createElement("span");
    label.className = "level-label";
    line.appendChild(label);
    line.addEventListener("pointerdown", (e) => this.beginDrag(e, id));
    this.overlay.appendChild(line);
    return line;
  }

  private beginDrag(e: PointerEvent, id: number): void {
    if (!this.enabled) return;
    e.preventDefault();
    this.dragging = id;
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
    if (this.dragging === null) return;
    const rect = this.chart.element.getBoundingClientRect();
    const price = this.chart.yToPrice(e.clientY - rect.top);
    if (price === null) return;
    const m = this.marks.find((x) => x.id === this.dragging);
    if (m) {
      m.price = this.round(price);
      this.onChangeCb();
    }
  }

  private loop = (): void => {
    for (const m of this.marks) {
      const line = this.lines.get(m.id)!;
      const y = this.chart.priceToY(m.price);
      if (y === null) {
        line.style.display = "none";
        continue;
      }
      line.style.display = "block";
      line.style.top = `${y}px`;
      (line.firstChild as HTMLSpanElement).textContent = m.price.toFixed(2);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private round(p: number): number {
    return Math.round(p / this.tick) * this.tick;
  }
}
