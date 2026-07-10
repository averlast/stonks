import type { Sec1Bar, Candle, Timeframe } from "../types";
import { TimeframeAggregator } from "../engine/aggregator";

/**
 * Fold an entire day of 1s bars into the complete candle series for a timeframe —
 * every sealed candle plus the final (partial) forming one. Review uses this once
 * the attempt is conceded and the whole day is unlocked for free bidirectional
 * scrubbing (ADR-0002); during the attempt the playback engine only ever folds up
 * to the sim clock, never the whole day.
 */
export function foldDay(bars: readonly Sec1Bar[], tf: Timeframe): Candle[] {
  const agg = new TimeframeAggregator(tf);
  const out: Candle[] = [];
  for (const b of bars) {
    const { sealed } = agg.push(b);
    if (sealed) out.push(sealed);
  }
  if (agg.current) out.push(agg.current); // the last bucket never "seals"
  return out;
}
