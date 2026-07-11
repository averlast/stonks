import type { ChartView } from "../chart/chartView";

/** A single-price mark (a support/resistance level). */
interface LineMark {
  id: number;
  kind: "line";
  price: number;
}
/** A price-range mark (a zone: value area, supply/demand). */
interface ZoneMark {
  id: number;
  kind: "zone";
  low: number;
  high: number;
}
type Mark = LineMark | ZoneMark;

type LineEls = { kind: "line"; line: HTMLDivElement };
type ZoneEls = { kind: "zone"; band: HTMLDivElement; hi: HTMLDivElement; lo: HTMLDivElement };
type Els = LineEls | ZoneEls;

type DragTarget = { id: number; edge: "line" | "hi" | "lo" };

/**
 * The Prep marking tool (#7): draggable horizontal **levels** and shaded
 * **ranges** the trader places on the prior-day chart to mark where they believe
 * the pre-session levels / zones are. Built on the same overlay + price↔pixel
 * approach as `bracketEditor.ts` (Lightweight Charts has no native tools).
 *
 * The eval is practising the *ritual* of marking, so everything is freely
 * draggable against the visible bars; on Commit the tool locks and the true
 * levels are revealed separately (ChartView.setLevelLines).
 */
export class LevelMarker {
  private overlay: HTMLDivElement;
  private marks: Mark[] = [];
  private els = new Map<number, Els>();
  private seq = 0;
  private raf = 0;
  private dragging: DragTarget | null = null;
  /** A level being placed click-to-drop: its ghost element + the live price. */
  private placing: { line: HTMLDivElement; price: number } | null = null;
  private placeCleanup: (() => void) | null = null;
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

  /** Fires on add / drag / remove / clear, so the panel can re-render the list. */
  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  get marksList(): readonly Mark[] {
    return this.marks;
  }
  /** The marked single-price levels (what commit freezes as levels). */
  get lines(): number[] {
    return this.marks.filter((m): m is LineMark => m.kind === "line").map((m) => m.price);
  }
  /** The marked ranges (what commit freezes as zones). */
  get zones(): { low: number; high: number }[] {
    return this.marks
      .filter((m): m is ZoneMark => m.kind === "zone")
      .map((m) => ({ low: m.low, high: m.high }));
  }

  start(): void {
    this.overlay.classList.add("active");
    if (this.raf === 0) this.loop();
  }

  addLine(price: number): void {
    if (!this.enabled) return;
    const id = ++this.seq;
    this.marks.push({ id, kind: "line", price: this.round(price) });
    const line = this.makeLine("level-line", id, "line");
    this.els.set(id, { kind: "line", line });
    this.onChangeCb();
  }

  /** Enter click-to-place: a ghost level tracks the cursor over the chart and the
   *  next click drops it there. `seed` positions it before the first mouse move (and
   *  is where a click-without-move lands). Clicking the tool again, or Escape,
   *  cancels. Preferred over `addLine` for the ＋ Level button — placing feels direct. */
  beginPlaceLine(seed: number): void {
    if (!this.enabled) return;
    if (this.placing) {
      this.cancelPlace(); // toggle off if already arming
      return;
    }
    const line = document.createElement("div");
    line.className = "level-line ghost";
    line.appendChild(Object.assign(document.createElement("span"), { className: "level-label" }));
    this.overlay.appendChild(line);
    this.placing = { line, price: this.round(seed) };
    this.paintGhost(this.chart.priceToY(this.placing.price));

    const el = this.chart.element;
    const move = (ev: PointerEvent) => {
      if (!this.placing) return;
      const y = ev.clientY - el.getBoundingClientRect().top;
      const raw = this.chart.yToPrice(y);
      if (raw === null) return;
      this.placing.price = this.round(raw);
      this.paintGhost(y);
    };
    const drop = (ev: PointerEvent) => {
      if (!this.placing) return;
      // The toolbar sits inside the chart, so its clicks bubble here too (including the
      // ＋ Level click that armed this) — those are never placements.
      if ((ev.target as HTMLElement | null)?.closest("#chartTools")) return;
      ev.preventDefault();
      ev.stopPropagation();
      const price = this.placing.price;
      this.cancelPlace();
      this.addLine(price);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") this.cancelPlace();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("click", drop);
    window.addEventListener("keydown", key);
    this.placeCleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("click", drop);
      window.removeEventListener("keydown", key);
    };
  }

  /** True while a level is arming (so the panel can reflect the tool state). */
  get placingLine(): boolean {
    return this.placing !== null;
  }

  private paintGhost(y: number | null): void {
    if (!this.placing) return;
    const line = this.placing.line;
    if (y === null) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.top = `${y}px`;
    (line.firstChild as HTMLSpanElement).textContent = this.placing.price.toFixed(2);
  }

  private cancelPlace(): void {
    if (!this.placing) return;
    this.placing.line.remove();
    this.placing = null;
    this.placeCleanup?.();
    this.placeCleanup = null;
    this.onChangeCb(); // so the toolbar can drop the armed highlight
  }

  addZone(low: number, high: number): void {
    if (!this.enabled) return;
    const id = ++this.seq;
    this.marks.push({ id, kind: "zone", low: this.round(low), high: this.round(high) });
    const band = document.createElement("div");
    band.className = "zone-band";
    this.overlay.appendChild(band);
    const hi = this.makeLine("zone-edge", id, "hi");
    const lo = this.makeLine("zone-edge", id, "lo");
    this.els.set(id, { kind: "zone", band, hi, lo });
    this.onChangeCb();
  }

  remove(id: number): void {
    if (!this.enabled) return;
    this.marks = this.marks.filter((m) => m.id !== id);
    const e = this.els.get(id);
    if (e) {
      if (e.kind === "line") e.line.remove();
      else {
        e.band.remove();
        e.hi.remove();
        e.lo.remove();
      }
      this.els.delete(id);
    }
    this.onChangeCb();
  }

  clear(): void {
    if (!this.enabled) return;
    for (const id of [...this.els.keys()]) this.remove(id);
  }

  /** Freeze the marks (post-commit): no more add/drag/remove. */
  disable(): void {
    this.cancelPlace();
    this.enabled = false;
    this.overlay.classList.add("locked");
  }

  /** Tear down the overlay (leaving Prep for the attempt). */
  destroy(): void {
    this.cancelPlace();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.overlay.remove();
  }

  // --- internals ------------------------------------------------------------
  private makeLine(cls: string, id: number, edge: DragTarget["edge"]): HTMLDivElement {
    const line = document.createElement("div");
    line.className = cls;
    const label = document.createElement("span");
    label.className = "level-label";
    line.appendChild(label);
    line.addEventListener("pointerdown", (e) => this.beginDrag(e, { id, edge }));
    this.overlay.appendChild(line);
    return line;
  }

  private beginDrag(e: PointerEvent, target: DragTarget): void {
    if (!this.enabled) return;
    e.preventDefault();
    this.dragging = target;
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
    if (!this.dragging) return;
    const rect = this.chart.element.getBoundingClientRect();
    const raw = this.chart.yToPrice(e.clientY - rect.top);
    if (raw === null) return;
    const p = this.round(raw);
    const mark = this.marks.find((m) => m.id === this.dragging!.id);
    if (!mark) return;
    if (mark.kind === "line") {
      mark.price = p;
    } else if (this.dragging.edge === "hi") {
      mark.high = Math.max(p, mark.low + this.tick); // stay above the low edge
    } else {
      mark.low = Math.min(p, mark.high - this.tick); // stay below the high edge
    }
    this.onChangeCb();
  }

  private loop = (): void => {
    for (const mark of this.marks) {
      const e = this.els.get(mark.id)!;
      if (mark.kind === "line" && e.kind === "line") {
        this.place(e.line, mark.price, mark.price.toFixed(2));
      } else if (mark.kind === "zone" && e.kind === "zone") {
        const yHi = this.chart.priceToY(mark.high);
        const yLo = this.chart.priceToY(mark.low);
        this.place(e.hi, mark.high, `${mark.high.toFixed(2)}`);
        this.place(e.lo, mark.low, `${mark.low.toFixed(2)}`);
        if (yHi === null || yLo === null) {
          e.band.style.display = "none";
        } else {
          e.band.style.display = "block";
          e.band.style.top = `${yHi}px`;
          e.band.style.height = `${Math.max(0, yLo - yHi)}px`;
        }
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private place(line: HTMLDivElement, price: number, text: string): void {
    const y = this.chart.priceToY(price);
    if (y === null) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.top = `${y}px`;
    (line.firstChild as HTMLSpanElement).textContent = text;
  }

  private round(p: number): number {
    return Math.round(p / this.tick) * this.tick;
  }
}
