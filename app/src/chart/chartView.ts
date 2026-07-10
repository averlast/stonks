import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type CandlestickData,
} from "lightweight-charts";
import type { Candle } from "../types";

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

  constructor(container: HTMLElement) {
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
      },
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
