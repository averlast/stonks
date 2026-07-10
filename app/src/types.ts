/** One 1-second OHLCV bar. `t` is the chart-time epoch (seconds) — see
 *  ingestion/export_dev_json.py for the exchange-local-as-UTC convention. */
export interface Sec1Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** A folded candle for some timeframe. `time` is the bucket-start epoch (seconds). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Timeframe bucket size in seconds. 1m/5m/15m are co-primary (ADR-0002 amendment). */
export type Timeframe = 60 | 300 | 900;
