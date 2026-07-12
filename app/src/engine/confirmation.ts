import type { Candle } from "../types";
import type { Side } from "./fillEngine";

/**
 * Confirmation flags + setup tags (#10 / ADR-0003). At each entry the engine stamps
 * four OBJECTIVE, deterministic confirmation flags — the evidence a level would hold
 * that the trader's method looks for (CONTEXT: a 5m close beyond the level, a volume
 * increase, an in-direction engulfing candle, and agreement with the HTF trend). The
 * trader separately tags each trade's setup from a fixed vocabulary. Both ride the
 * trade record into the grade digest; the AI narrates on them but never scores them.
 *
 * Pure functions over the multi-timeframe candle snapshots (#9) at entry time, so the
 * same attempt always stamps the same flags. The 5m candle is the confirmation
 * timeframe; the 15m is the higher-timeframe trend (why #10 was blocked on #9).
 */

/** The setup vocabulary — the six trade archetypes in CONTEXT ("Setups"). */
export const SETUP_TAGS = [
  "breakout-retest",
  "range",
  "retracement-continuation",
  "failed-auction",
  "sweep-reversal",
  "supply-demand",
] as const;
export type SetupTag = (typeof SETUP_TAGS)[number];

export function isSetupTag(v: string): v is SetupTag {
  return (SETUP_TAGS as readonly string[]).includes(v);
}

/** The four confirmation flags stamped at entry, plus the read HTF trend for
 *  narration. All booleans are deterministic over the sealed candles at entry. */
export interface ConfirmationFlags {
  /** A sealed 5m candle closed beyond the entry (≈ the traded level) in-direction. */
  fiveMinCloseBeyond: boolean;
  /** The latest sealed 5m volume beat its trailing average (a volume increase). */
  volumeIncrease: boolean;
  /** The last two sealed 5m candles formed an in-direction engulfing pattern. */
  engulfing: boolean;
  /** The trade agrees with the 15m (higher-timeframe) trend. */
  withHtfTrend: boolean;
  /** The read HTF trend at entry — context for the coach/UI, not itself a score. */
  htfTrend: "up" | "down" | "flat";
}

/** Open params for the flags — per-symbol, since "a volume bump" and "a trend" are
 *  not the same magnitude on NQ vs ES (mirrors GRADE_CONFIGS; NQ tuned first). */
export interface ConfirmationConfig {
  /** Trailing sealed 5m candles to average for the volume-increase test. */
  volumeLookback: number;
  /** Latest 5m volume must exceed this multiple of the trailing average. */
  volumeFactor: number;
  /** |15m net (last close − first open)| at or above this reads as a directional HTF trend. */
  htfTrendPts: number;
}

export const CONFIRMATION_CONFIGS: Record<string, ConfirmationConfig> = {
  NQ: { volumeLookback: 3, volumeFactor: 1.2, htfTrendPts: 30 },
  MNQ: { volumeLookback: 3, volumeFactor: 1.2, htfTrendPts: 30 },
  ES: { volumeLookback: 3, volumeFactor: 1.2, htfTrendPts: 8 },
  MES: { volumeLookback: 3, volumeFactor: 1.2, htfTrendPts: 8 },
};

export function confirmationConfig(symbol: string): ConfirmationConfig {
  return CONFIRMATION_CONFIGS[symbol] ?? CONFIRMATION_CONFIGS.NQ;
}

export interface ConfirmationInput {
  side: Side;
  /** The entry price — stands in for the traded level (chart-drawn entries carry no
   *  separate level price), so "close beyond the level" ≈ "close beyond the entry". */
  entryPrice: number;
  /** Sealed 5m candles up to (excluding) the one still forming at entry — no lookahead. */
  m5Sealed: readonly Candle[];
  /** Sealed 15m candles up to the one still forming at entry. */
  m15Sealed: readonly Candle[];
  config: ConfirmationConfig;
}

/** Stamp the four confirmation flags for an entry from the multi-timeframe state. */
export function computeConfirmation(i: ConfirmationInput): ConfirmationFlags {
  const long = i.side === "long";
  const last5 = i.m5Sealed.length ? i.m5Sealed[i.m5Sealed.length - 1] : null;

  const fiveMinCloseBeyond =
    last5 !== null && (long ? last5.close > i.entryPrice : last5.close < i.entryPrice);

  const htfTrend = readHtfTrend(i.m15Sealed, i.config.htfTrendPts);
  const withHtfTrend = (htfTrend === "up" && long) || (htfTrend === "down" && !long);

  return {
    fiveMinCloseBeyond,
    volumeIncrease: detectVolumeIncrease(i.m5Sealed, i.config),
    engulfing: detectEngulfing(i.m5Sealed, i.side),
    withHtfTrend,
    htfTrend,
  };
}

/** True when the latest sealed candle's volume exceeds `volumeFactor` × the average
 *  of the `volumeLookback` candles before it. Needs at least one prior candle. */
function detectVolumeIncrease(sealed: readonly Candle[], cfg: ConfirmationConfig): boolean {
  const n = sealed.length;
  if (n < 2) return false;
  const last = sealed[n - 1];
  const prior = sealed.slice(Math.max(0, n - 1 - cfg.volumeLookback), n - 1);
  if (prior.length === 0) return false;
  const avg = prior.reduce((s, c) => s + c.volume, 0) / prior.length;
  return avg > 0 && last.volume > cfg.volumeFactor * avg;
}

/** True when the last two sealed candles form an engulfing pattern in the trade's
 *  direction: a bullish engulfing for a long (a green candle whose body wraps the
 *  prior red body), the mirror for a short. */
function detectEngulfing(sealed: readonly Candle[], side: Side): boolean {
  const n = sealed.length;
  if (n < 2) return false;
  const prev = sealed[n - 2];
  const last = sealed[n - 1];
  if (side === "long") {
    return (
      last.close > last.open && // green
      prev.close < prev.open && // prior red
      last.close >= prev.open &&
      last.open <= prev.close
    );
  }
  return (
    last.close < last.open && // red
    prev.close > prev.open && // prior green
    last.close <= prev.open &&
    last.open >= prev.close
  );
}

/** The 15m trend since the open: directional when the net move from the first sealed
 *  candle's open to the last sealed candle's close clears `htfTrendPts`, else flat.
 *  Sealed-only, so no candle still in progress leaks a look-ahead read. */
function readHtfTrend(sealed: readonly Candle[], htfTrendPts: number): "up" | "down" | "flat" {
  if (sealed.length === 0) return "flat";
  const net = sealed[sealed.length - 1].close - sealed[0].open;
  if (net >= htfTrendPts) return "up";
  if (net <= -htfTrendPts) return "down";
  return "flat";
}
