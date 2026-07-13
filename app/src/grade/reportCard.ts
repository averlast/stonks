import type { Sec1Bar } from "../types";
import type { BiasCall } from "../session/events";
import type { BiasScore, GradeConfig, MarketStructure, ReportCard } from "./types";

/**
 * The objective report card (#8, bucket 1). Pure functions over the sealed inputs —
 * the realized 2h window and the committed bias call — so the same attempt always
 * scores the same. The AI is handed these numbers; it never recomputes them (ADR-0003).
 *
 * Level-marking is NO LONGER scored: the trader still marks pre-session levels in Prep
 * (a personal-discipline ritual) and the true levels are still revealed, but grading
 * their precision wasn't useful, so the report card is now just the bias classification.
 */

/**
 * The realized shape of the traded window, computed deterministically from the
 * sealed bars. Directional when the net move is a large-enough fraction of the
 * day's range; otherwise chop (the range was churned, not trended).
 */
export function classifyStructure(
  bars: readonly Sec1Bar[],
  cfg: GradeConfig,
): MarketStructure {
  if (bars.length === 0) {
    return { open: 0, close: 0, high: 0, low: 0, netPoints: 0, rangePoints: 0, realizedBias: "chop" };
  }
  const open = bars[0].o;
  const close = bars[bars.length - 1].c;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
  }
  const netPoints = close - open;
  const rangePoints = high - low;
  let realizedBias: BiasCall = "chop";
  if (rangePoints > 0 && Math.abs(netPoints) / rangePoints >= cfg.biasDirectionalFraction) {
    realizedBias = netPoints > 0 ? "bull" : "bear";
  }
  return { open, close, high, low, netPoints, rangePoints, realizedBias };
}

/** Grade the committed bias call against the realized structure. */
export function scoreBias(called: BiasCall, structure: MarketStructure): BiasScore {
  return {
    called,
    realized: structure.realizedBias,
    correct: called === structure.realizedBias,
    netPoints: structure.netPoints,
    rangePoints: structure.rangePoints,
  };
}

/** Assemble the objective report card from the sealed inputs (bias call only). */
export function buildReportCard(called: BiasCall, structure: MarketStructure): ReportCard {
  return { bias: scoreBias(called, structure) };
}
