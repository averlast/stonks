import type { Contract } from "../engine/contracts";
import type { Trade } from "../engine/fillEngine";
import type { Prep } from "../session/events";
import type { Digest, MarketStructure, ReportCard, TradeDigest } from "./types";

/**
 * Build the compact digest for the AI call (#8): the frozen prep and journal
 * verbatim, the objective report-card numbers, the realized day structure, and the
 * distilled trade tape. No raw bars — the AI reasons over the summary, not the feed.
 */

/** Distance from a price to the trader's nearest marked level, or null if none. */
function nearestMarkDistance(price: number, marked: readonly number[]): number | null {
  if (marked.length === 0) return null;
  return Math.min(...marked.map((m) => Math.abs(m - price)));
}

/** Distill one trade for the digest, folding in its proximity to a marked level and
 *  whether its direction agreed with the committed bias. */
function distillTrade(
  t: Trade,
  markedPrices: readonly number[],
  biasCall: Prep["biasCall"],
): TradeDigest {
  const alignedWithBias =
    (biasCall === "bull" && t.side === "long") ||
    (biasCall === "bear" && t.side === "short");
  return {
    side: t.side,
    level: t.level,
    reason: t.reason,
    avgEntry: t.avgEntry,
    exitPrice: t.exitPrice,
    exitReason: t.exitReason,
    exitMethod: t.exitMethod,
    riskPoints: t.riskPoints,
    maePoints: t.maePoints,
    mfePoints: t.mfePoints,
    rMultiple: t.rMultiple,
    pnlUsd: t.pnlUsd,
    entryProximityToMark: nearestMarkDistance(t.avgEntry, markedPrices),
    alignedWithBias,
    heldSeconds: t.closedAt - t.openedAt,
    setupTag: t.setupTag,
    confirmation: t.confirmation,
  };
}

export interface DigestInput {
  symbol: string;
  date: string;
  attempt: number;
  prep: Prep;
  journal: string;
  trades: readonly Trade[];
  structure: MarketStructure;
  reportCard: ReportCard;
}

export function buildDigest(input: DigestInput): Digest {
  const { symbol, date, attempt, prep, journal, trades, structure, reportCard } = input;
  const markedPrices = prep.markedLevels.map((m) => m.price);

  const netR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const netUsd = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const winCount = trades.filter((t) => t.pnlUsd > 0).length;

  return {
    symbol,
    date,
    attempt,
    prep: {
      biasCall: prep.biasCall,
      biasProse: prep.biasProse,
      markedLevels: markedPrices,
      markedZones: prep.markedZones,
    },
    journal,
    marketStructure: structure,
    session: { tradeCount: trades.length, winCount, netR, netUsd },
    reportCard,
    trades: trades.map((t) => distillTrade(t, markedPrices, prep.biasCall)),
  };
}

/** Round a digest's floats for the prompt so a re-grade of the same attempt sends a
 *  stable string (cheaper to reason over; avoids 15-decimal noise). `Contract` is
 *  accepted for symmetry with the rest of the engine even though rounding is uniform. */
export function roundForPrompt(digest: Digest, _contract?: Contract): Digest {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    ...digest,
    marketStructure: {
      ...digest.marketStructure,
      open: r2(digest.marketStructure.open),
      close: r2(digest.marketStructure.close),
      high: r2(digest.marketStructure.high),
      low: r2(digest.marketStructure.low),
      netPoints: r2(digest.marketStructure.netPoints),
      rangePoints: r2(digest.marketStructure.rangePoints),
    },
    session: {
      ...digest.session,
      netR: r2(digest.session.netR),
      netUsd: r2(digest.session.netUsd),
    },
    trades: digest.trades.map((t) => ({
      ...t,
      avgEntry: r2(t.avgEntry),
      exitPrice: r2(t.exitPrice),
      riskPoints: r2(t.riskPoints),
      maePoints: r2(t.maePoints),
      mfePoints: r2(t.mfePoints),
      rMultiple: r2(t.rMultiple),
      pnlUsd: r2(t.pnlUsd),
      entryProximityToMark:
        t.entryProximityToMark === null ? null : r2(t.entryProximityToMark),
    })),
  };
}
