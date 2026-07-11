import type { Sec1Bar } from "../types";
import type { BiasCall } from "../session/events";
import type {
  BiasScore,
  GradeConfig,
  LevelMarkingScore,
  LevelScore,
  MarketStructure,
  ReportCard,
  TrueLevel,
} from "./types";

/**
 * The objective report card (#8, bucket 1). Pure functions over the sealed inputs —
 * the trader's blind marks, the true-level answer key, and the realized 2h window —
 * so the same attempt always scores the same. The AI is handed these numbers; it
 * never recomputes them (ADR-0003).
 */

/** Precision credit for a mark `d` points from its true level: full inside
 *  `tolerance`, linear decay to zero at `decay`, clamped to [0,1]. */
export function markCredit(d: number, tolerance: number, decay: number): number {
  if (d <= tolerance) return 1;
  if (d >= decay) return 0;
  return (decay - d) / (decay - tolerance);
}

/**
 * Score the blind level-marking drill: for each in-scope true level, find the
 * nearest mark and award precision credit. Coverage counts the levels that drew a
 * mark inside the decay band; precision averages the credit over those; overall
 * averages over ALL in-scope levels (an unmarked level scores zero).
 */
export function scoreLevelMarking(
  markedPrices: readonly number[],
  truth: readonly TrueLevel[],
  cfg: GradeConfig,
): LevelMarkingScore {
  const levels: LevelScore[] = truth.map((l) => {
    const nearest = markedPrices.length
      ? Math.min(...markedPrices.map((m) => Math.abs(m - l.price)))
      : null;
    const points =
      nearest === null ? 0 : markCredit(nearest, cfg.levelTolerancePts, cfg.levelDecayPts);
    return {
      id: l.id,
      label: l.label,
      truePrice: l.price,
      marked: points > 0,
      nearestMarkDistance: nearest,
      points,
    };
  });

  const covered = levels.filter((l) => l.marked);
  const coverage = levels.length ? covered.length / levels.length : 0;
  const precision = covered.length
    ? covered.reduce((s, l) => s + l.points, 0) / covered.length
    : 0;
  const overall = levels.length
    ? levels.reduce((s, l) => s + l.points, 0) / levels.length
    : 0;
  return { levels, coverage, precision, overall };
}

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

/** Assemble the full objective report card from the sealed inputs. */
export function buildReportCard(
  markedPrices: readonly number[],
  truth: readonly TrueLevel[],
  called: BiasCall,
  structure: MarketStructure,
  cfg: GradeConfig,
): ReportCard {
  return {
    levelMarking: scoreLevelMarking(markedPrices, truth, cfg),
    bias: scoreBias(called, structure),
  };
}
