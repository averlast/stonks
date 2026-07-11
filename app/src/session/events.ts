import type { BracketRequest, Fill, Trade } from "../engine/fillEngine";
import type { AiGrade, ReportCard } from "../grade/types";

/** The three bias reads the trader commits to at the Prep gate (#7). */
export type BiasCall = "bull" | "bear" | "chop";

/**
 * The Session event vocabulary (ADR-0005 / #5). A Session is one attempt of a
 * (historical-day, symbol); its record is an append-only NDJSON log of these
 * typed, timestamped events, and its *state* is a fold over them. Re-practicing a
 * day writes a NEW log (a new attempt) — never an overwrite.
 *
 * Every line carries the envelope (`seq`, `t`, `at`); `t` is the sim second the
 * action landed on (the historical clock), `at` is the real wall-clock instant it
 * was recorded, and `seq` is the strictly increasing write order.
 */
export interface Envelope {
  /** Strictly increasing write order within the Session. */
  seq: number;
  /** Sim second the action occurred at (historical clock; 0 before the open). */
  t: number;
  /** Real wall-clock instant recorded, ISO-8601. */
  at: string;
}

/** One pre-session level the trader marked blind during Prep (#7). `label` is
 *  optional free text; scoring matches a mark to the nearest true level regardless. */
export interface MarkedLevel {
  price: number;
  label?: string;
}

/** A marked price range (value area / supply-demand zone). AI-graded, not
 *  precision-scored (ADR-0003). */
export interface MarkedZone {
  low: number;
  high: number;
}

/** The frozen pre-market plan committed at the Prep gate (#7 / ADR-0003): the
 *  blind level + zone marks, a prose bias, and a bull/bear/chop call. Hashed into
 *  `prep_committed` so a post-hoc edit is visible in git (the seal is structural). */
export interface Prep {
  markedLevels: MarkedLevel[];
  markedZones: MarkedZone[];
  biasProse: string;
  biasCall: BiasCall;
}

export type SessionEvent =
  | { type: "session_started"; symbol: string; date: string; attempt: number }
  | { type: "prep_committed"; hash: string; prep: Prep }
  | { type: "order_placed"; orderId: string; order: BracketRequest }
  | { type: "order_cancelled"; orderId: string }
  | { type: "fill"; orderId: string; fill: Fill }
  | { type: "stop_moved"; orderId: string; stop: number; target: number }
  | { type: "flatten"; orderId: string; cause: "manual" | "end-of-day"; fill: Fill }
  | { type: "trade_closed"; trade: Trade }
  | { type: "end_of_day" }
  | { type: "grade_computed"; reportCard: ReportCard; aiGrade: AiGrade | null };

export type RecordedEvent = SessionEvent & Envelope;

/** The state a Session reconstructs to. Purely a fold over its events — never
 *  stored directly, so the log stays the single source of truth (decision 12). */
export interface SessionState {
  symbol: string;
  date: string;
  attempt: number;
  /** Hash of the committed prep, or null until prep is committed. */
  prepHash: string | null;
  /** The frozen prep itself, or null until committed — needed to grade the marks (#8). */
  prep: Prep | null;
  /** The sealed trade tape, in close order. */
  trades: Trade[];
  /** True once the attempt reached 11:30 and auto-flattened. */
  endOfDay: boolean;
  /** The sealed grade, or null until graded in Review (#8). */
  grade: { reportCard: ReportCard; aiGrade: AiGrade | null } | null;
}

/** Reconstruct Session state by folding the event log (ADR-0005). This is the
 *  authoritative read path; the optional SQLite index is just a cache of this. */
export function fold(events: readonly RecordedEvent[]): SessionState {
  const s: SessionState = {
    symbol: "",
    date: "",
    attempt: 0,
    prepHash: null,
    prep: null,
    trades: [],
    endOfDay: false,
    grade: null,
  };
  for (const e of events) {
    switch (e.type) {
      case "session_started":
        s.symbol = e.symbol;
        s.date = e.date;
        s.attempt = e.attempt;
        break;
      case "prep_committed":
        s.prepHash = e.hash;
        s.prep = e.prep;
        break;
      case "trade_closed":
        s.trades.push(e.trade);
        break;
      case "end_of_day":
        s.endOfDay = true;
        break;
      case "grade_computed":
        s.grade = { reportCard: e.reportCard, aiGrade: e.aiGrade };
        break;
      // order_placed / order_cancelled / fill / stop_moved / flatten are the
      // granular audit trail; the folded tape reads from the sealed trade_closed.
    }
  }
  return s;
}

/** Deterministic fingerprint of the frozen prep, canonicalised so key order can't
 *  change the hash. A committed plan that is edited after the outcome is known
 *  therefore shows a changed hash in git — the seal is structural, not promised
 *  (ADR-0005). Non-cryptographic (cyrb53); #7 can swap in SHA-256 if needed. */
export function hashPrep(prep: unknown): string {
  return cyrb53(canonical(prep));
}

/** JSON with object keys sorted recursively, so equal preps hash equal. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

/** cyrb53 — a fast, well-distributed 53-bit string hash, rendered as 14 hex. */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}
