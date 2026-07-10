import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
} from "lightweight-charts";
import type { Candle } from "../types";

/** Lightweight Charts wrapper. Renders one timeframe's candles; the forming
 *  right-most candle grows via `update()` (LWC grows-or-appends by time). */
export class ChartView {
  private chart: IChartApi;
  private series: ISeriesApi<"Candlestick">;

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
