import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type CandlestickData,
} from "lightweight-charts";
import type { Candle } from "../types";

/** One auto-computed intraday reference level to draw (#12). Colored by group;
 *  dotted while its window is still developing, solid once frozen. */
export interface IntradayLine {
  id: string;
  label: string;
  price: number;
  group: "OR" | "IB";
  complete: boolean;
}

/** A working bracket to draw as horizontal lines (null = not shown). */
export interface BracketLines {
  entry: number | null;
  stop: number | null;
  target: number | null;
}

/** A fill to mark on the chart. `time` should already be bucketed to the
 *  active timeframe by the caller so it aligns to a candle. */
export interface FillMarker {
  time: number;
  above: boolean;
  color: string;
  text: string;
}

/** Lightweight Charts wrapper. Renders one timeframe's candles; the forming
 *  right-most candle grows via `update()` (LWC grows-or-appends by time). */
export class ChartView {
  private chart: IChartApi;
  private series: ISeriesApi<"Candlestick">;
  private markers: ISeriesMarkersPluginApi<Time>;
  private priceLines: IPriceLine[] = [];
  private levelLines: IPriceLine[] = [];
  private intradayLines: IPriceLine[] = [];
  private vwap: ISeriesApi<"Line">;
  readonly element: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = container;
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "#0e1116" },
        textColor: "#c9d1d9",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      grid: {
        vertLines: { color: "#191f27" },
        horzLines: { color: "#191f27" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#2a3038",
        rightOffset: 3,
        // `t` is the ET wall clock encoded as a UTC epoch (ingestion convention), so
        // formatting its UTC components always yields ET — no browser-locale or DST
        // drift, ever. Axis ticks show HH:MM.
        tickMarkFormatter: etHm,
      },
      // Crosshair vertical label shows the ET wall clock to the second.
      localization: { timeFormatter: etHms },
      rightPriceScale: { borderColor: "#2a3038" },
      crosshair: { mode: 0 },
    });
    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      borderVisible: false,
    });
    this.markers = createSeriesMarkers(this.series, []);
    // The NY-open VWAP as a developing line on the same time grid as the candles
    // (#12). Cyan, thin, no per-point crosshair marker so it reads as context.
    this.vwap = this.chart.addSeries(LineSeries, {
      color: "#22d3ee",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: "VWAP",
    });
  }

  /** Draw/replace the working bracket as dashed horizontal lines. */
  setBracket(b: BracketLines): void {
    for (const l of this.priceLines) this.series.removePriceLine(l);
    this.priceLines = [];
    const add = (price: number, color: string, title: string) =>
      this.priceLines.push(
        this.series.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        }),
      );
    if (b.entry !== null) add(b.entry, "#3b82f6", "entry");
    if (b.stop !== null) add(b.stop, "#ef5350", "stop");
    if (b.target !== null) add(b.target, "#26a69a", "target");
  }

  /** Draw persistent horizontal reference lines that survive `setData` into the
   *  attempt (#7): the revealed true levels plus the trader's own marks. Kept
   *  separate from the working-order bracket lines so the two never clobber. */
  setLevelLines(
    levels: readonly { label: string; price: number; color?: string; dashed?: boolean }[],
  ): void {
    for (const l of this.levelLines) this.series.removePriceLine(l);
    this.levelLines = levels.map((lv) =>
      this.series.createPriceLine({
        price: lv.price,
        color: lv.color ?? "#eab308",
        lineWidth: 1,
        lineStyle: lv.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: lv.label,
      }),
    );
  }

  /** Draw/replace the auto-computed intraday levels (OR/IB, #12) as their own
   *  price-line layer so they never clobber the pre-session `setLevelLines`. OR is
   *  sky, IB is orange; a still-developing window is dotted, a frozen one solid. */
  setIntradayLevels(levels: readonly IntradayLine[]): void {
    for (const l of this.intradayLines) this.series.removePriceLine(l);
    this.intradayLines = levels.map((lv) =>
      this.series.createPriceLine({
        price: lv.price,
        color: lv.group === "OR" ? "#38bdf8" : "#fb923c",
        lineWidth: 1,
        lineStyle: lv.complete ? LineStyle.Solid : LineStyle.Dotted,
        axisLabelVisible: true,
        title: lv.label,
      }),
    );
  }

  /** Replace the whole VWAP curve (load / timeframe switch / review), pre-folded to
   *  the active timeframe's bucket grid by the caller. */
  setVwapCurve(points: readonly { time: number; value: number }[]): void {
    this.vwap.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })) as LineData[]);
  }

  /** Grow/append the current VWAP bucket (live tick). `time` must be the active
   *  timeframe's bucket-start, matching the forming candle. */
  updateVwap(time: number, value: number): void {
    this.vwap.update({ time: time as UTCTimestamp, value });
  }

  clearVwap(): void {
    this.vwap.setData([]);
  }

  clearIntradayLevels(): void {
    for (const l of this.intradayLines) this.series.removePriceLine(l);
    this.intradayLines = [];
  }

  setFillMarkers(marks: readonly FillMarker[]): void {
    const m: SeriesMarker<Time>[] = marks.map((k) => ({
      time: k.time as UTCTimestamp,
      position: k.above ? "aboveBar" : "belowBar",
      color: k.color,
      shape: "circle",
      text: k.text,
    }));
    this.markers.setMarkers(m);
  }

  /** Replace all candles (used on load and timeframe switch). */
  setData(candles: readonly Candle[]): void {
    this.series.setData(candles.map(toLwc));
  }

  /** Grow or append the forming right-most candle. */
  updateForming(c: Candle): void {
    this.series.update(toLwc(c));
  }

  fitContent(): void {
    this.chart.timeScale().fitContent();
  }

  /** Pixel y (relative to the pane top) for a price, or null if off-screen. */
  priceToY(price: number): number | null {
    return this.series.priceToCoordinate(price);
  }

  /** Price for a pixel y (relative to the pane top), or null if unavailable. */
  yToPrice(y: number): number | null {
    return this.series.coordinateToPrice(y) as number | null;
  }

  /** Freeze/unfreeze vertical autoscaling — pinned while drawing a bracket so the
   *  lines don't drift as new candles rescale the axis. */
  setPriceAutoScale(on: boolean): void {
    this.chart.priceScale("right").applyOptions({ autoScale: on });
  }

}

/** ET wall clock (HH:MM:SS) from an ET-as-UTC epoch. Non-numeric Time (business
 *  days) never occurs for our intraday feed, but is handled defensively. */
function etHms(t: Time): string {
  return typeof t === "number" ? new Date(t * 1000).toISOString().slice(11, 19) : String(t);
}
function etHm(t: Time): string {
  return typeof t === "number" ? new Date(t * 1000).toISOString().slice(11, 16) : String(t);
}

function toLwc(c: Candle): CandlestickData {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}
