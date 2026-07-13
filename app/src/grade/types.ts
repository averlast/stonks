/**
 * The grade vocabulary (#8 / ADR-0003, SPEC §5). A grade has two buckets that never
 * mix:
 *   (1) the **report card** — objective, engine-computed here in portable TS
 *       (the bias call vs the realized 2h window), and
 *   (2) the **AI synthesis** — one Anthropic call that narrates adherence / execution
 *       / outcome and coaches. It is handed the already-computed report-card numbers
 *       and must NOT recompute them.
 * Both are sealed into a `grade_computed` event and shown in Review.
 *
 * This is the leaf module: every other grade file (and the session log) imports
 * types from here, so there is no import cycle between `session/` and `grade/`.
 */
import type { BiasCall } from "../session/events";
import type { ConfirmationFlags, SetupTag } from "../engine/confirmation";

export type { BiasCall };

/**
 * Scoring knobs — decided in shape, numbers still to tune (ADR-0003 open params).
 * Bias thresholds are scored over the 2h traded window. (Level-marking is no longer
 * scored, so the per-symbol level tolerances were removed.)
 */
export interface GradeConfig {
  /** |net| / range at or above this over the 2h window reads as directional (else chop). */
  biasDirectionalFraction: number;
}

/** Per-symbol bias thresholds (open params, ADR-0003). NQ tuned first; others mirror
 *  it until hand-calibrated. */
export const GRADE_CONFIGS: Record<string, GradeConfig> = {
  NQ: { biasDirectionalFraction: 0.34 },
  MNQ: { biasDirectionalFraction: 0.34 },
  ES: { biasDirectionalFraction: 0.34 },
  MES: { biasDirectionalFraction: 0.34 },
};

export function gradeConfig(symbol: string): GradeConfig {
  return GRADE_CONFIGS[symbol] ?? GRADE_CONFIGS.NQ;
}

/** The realized shape of the 2h traded window — the answer the bias call is graded
 *  against. Computed deterministically from the sealed bars, never from the AI. */
export interface MarketStructure {
  open: number;
  close: number;
  high: number;
  low: number;
  netPoints: number;
  rangePoints: number;
  realizedBias: BiasCall;
}

/** The bias call graded against the realized window. */
export interface BiasScore {
  called: BiasCall;
  realized: BiasCall;
  correct: boolean;
  netPoints: number;
  rangePoints: number;
}

/** The objective report card (bucket 1). Just the bias classification now —
 *  level-marking precision-scoring was removed (wasn't useful) and volume-zone
 *  accuracy is deferred to the profiles module (#14). */
export interface ReportCard {
  bias: BiasScore;
}

/** One trade, distilled for the AI digest — no raw bars. */
export interface TradeDigest {
  side: "long" | "short";
  level?: string;
  reason?: string;
  avgEntry: number;
  exitPrice: number;
  exitReason: string;
  exitMethod: string;
  riskPoints: number;
  maePoints: number;
  mfePoints: number;
  rMultiple: number;
  pnlUsd: number;
  /** Distance from the average entry to the trader's nearest marked level. */
  entryProximityToMark: number | null;
  /** Was the trade's direction consistent with the committed bias call? */
  alignedWithBias: boolean;
  heldSeconds: number;
  /** How many entry adds / partial exits built and unwound this position (#11).
   *  1/1 is a plain single-bracket trade; more means the trader scaled in/out. */
  entryCount: number;
  exitCount: number;
  /** The trader's setup archetype for this trade (#10), if tagged. */
  setupTag?: SetupTag;
  /** The objective confirmation flags stamped at entry (#10). */
  confirmation?: ConfirmationFlags;
}

/** The compact digest handed to the AI: prep + journal verbatim, the objective
 *  numbers, day structure, and the distilled trade tape — never raw bars (#8). */
export interface Digest {
  symbol: string;
  date: string;
  attempt: number;
  prep: {
    biasCall: BiasCall;
    biasProse: string;
    markedLevels: number[];
    markedZones: { low: number; high: number }[];
  };
  journal: string;
  marketStructure: MarketStructure;
  session: {
    tradeCount: number;
    winCount: number;
    netR: number;
    netUsd: number;
  };
  reportCard: ReportCard;
  trades: TradeDigest[];
  /** Auto-computed intraday objective levels (#12): the frozen OR/IB catalog + final
   *  NY-open VWAP over the sealed day. Context for the coach — UNSCORED (nothing about
   *  levels is scored anymore; the marks are a Prep ritual only). */
  intradayLevels?: {
    vwap: number | null;
    levels: { id: string; label: string; price: number }[];
  };
}

/** One graded axis: a 0–100 score plus a short coaching note. */
export interface GradeAxis {
  score: number;
  notes: string;
}

/** The AI synthesis (bucket 2) — three axes plus a summary. It narrates and coaches;
 *  it does not produce the objective report-card numbers. */
export interface AiGrade {
  planAdherence: GradeAxis;
  execution: GradeAxis;
  outcome: GradeAxis;
  summary: string;
}
