/* Tests for the grade slice (#8). Run: npm test. The report card must score the
 * blind marks and the bias call deterministically from the sealed inputs, and the AI
 * request/response plumbing must build and parse without a network. */
import assert from "node:assert/strict";
import type { Sec1Bar } from "../types";
import type { Trade } from "../engine/fillEngine";
import type { Prep } from "../session/events";
import { fold, type RecordedEvent } from "../session/events";
import {
  buildReportCard,
  classifyStructure,
  markCredit,
  scoreBias,
  scoreLevelMarking,
} from "./reportCard";
import { buildDigest } from "./digest";
import { buildGradeRequest, parseAiGrade } from "./grade";
import { gradeConfig, type TrueLevel } from "./types";

const CFG = gradeConfig("NQ"); // tol 10, decay 40, directional 0.34
const bar = (t: number, o: number, h: number, l: number, c: number): Sec1Bar =>
  ({ t, o, h, l, c, v: 1 });

const TRUTH: TrueLevel[] = [
  { id: "PDH", label: "Prior day high", kind: "pre_session", price: 18761 },
  { id: "PDL", label: "Prior day low", kind: "pre_session", price: 18385.75 },
  { id: "ONH", label: "Overnight high", kind: "pre_session", price: 18390 },
  { id: "ONL", label: "Overnight low", kind: "pre_session", price: 17351 },
];

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n`, e);
    process.exitCode = 1;
  }
}

test("markCredit is full inside tolerance, decays linearly, zero past decay", () => {
  assert.equal(markCredit(0, 10, 40), 1);
  assert.equal(markCredit(10, 10, 40), 1);
  assert.equal(markCredit(40, 10, 40), 0);
  assert.equal(markCredit(999, 10, 40), 0);
  // Midpoint of the decay band (25 pts) → half credit.
  assert.equal(markCredit(25, 10, 40), 0.5);
});

test("scoreLevelMarking rewards coverage and precision, penalises misses", () => {
  // Well-separated levels so each mark scores exactly one (the real PDL/ONH sit only
  // ~4 pts apart, so a single mark legitimately covers both — tested via the whole key).
  const sep: TrueLevel[] = [
    { id: "A", label: "A", kind: "x", price: 1000 },
    { id: "B", label: "B", kind: "x", price: 2000 },
    { id: "C", label: "C", kind: "x", price: 3000 },
    { id: "D", label: "D", kind: "x", price: 4000 },
  ];
  // A exact, B within tolerance (5), C a near-miss (25 → 0.5), D unmarked.
  const s = scoreLevelMarking([1000, 1995, 3025], sep, CFG);
  const byId = Object.fromEntries(s.levels.map((l) => [l.id, l]));
  assert.equal(byId.A.points, 1);
  assert.equal(byId.B.points, 1); // 5 pts off, inside tolerance
  assert.equal(byId.C.points, 0.5); // 25 pts off, half credit
  assert.equal(byId.D.marked, false); // nearest mark 975 pts away
  assert.equal(byId.D.points, 0);
  assert.equal(s.coverage, 3 / 4); // three levels drew a mark in-band
  // precision = mean over covered (1 + 1 + 0.5)/3; overall folds the miss in.
  assert.ok(Math.abs(s.precision - 2.5 / 3) < 1e-9);
  assert.ok(Math.abs(s.overall - 2.5 / 4) < 1e-9);
});

test("scoreLevelMarking with no marks scores zero, not NaN", () => {
  const s = scoreLevelMarking([], TRUTH, CFG);
  assert.equal(s.coverage, 0);
  assert.equal(s.precision, 0);
  assert.equal(s.overall, 0);
  assert.equal(s.levels[0].nearestMarkDistance, null);
});

test("classifyStructure reads a strong net move as directional, churn as chop", () => {
  // Trend up: open 100, range 100, close +80 (net/range = 0.8 ≥ 0.34) → bull.
  const bull = [bar(0, 100, 200, 100, 180), bar(1, 180, 200, 100, 180)];
  assert.equal(classifyStructure(bull, CFG).realizedBias, "bull");
  // Churn: big range, tiny net (5/100 = 0.05 < 0.34) → chop.
  const chop = [bar(0, 100, 150, 50, 105), bar(1, 105, 150, 50, 105)];
  assert.equal(classifyStructure(chop, CFG).realizedBias, "chop");
  // Trend down.
  const bear = [bar(0, 100, 100, 0, 20), bar(1, 20, 100, 0, 20)];
  assert.equal(classifyStructure(bear, CFG).realizedBias, "bear");
});

test("classifyStructure reports the window's net and range", () => {
  const s = classifyStructure([bar(0, 100, 130, 90, 120), bar(1, 120, 140, 95, 118)], CFG);
  assert.equal(s.open, 100);
  assert.equal(s.close, 118);
  assert.equal(s.high, 140);
  assert.equal(s.low, 90);
  assert.equal(s.netPoints, 18);
  assert.equal(s.rangePoints, 50);
});

test("scoreBias marks a matched call correct", () => {
  const s = classifyStructure([bar(0, 100, 200, 100, 180)], CFG); // bull
  assert.equal(scoreBias("bull", s).correct, true);
  assert.equal(scoreBias("bear", s).correct, false);
  assert.equal(scoreBias("chop", s).realized, "bull");
});

const PREP: Prep = {
  markedLevels: [{ price: 18400 }, { price: 17360, label: "onl" }],
  markedZones: [{ low: 17300, high: 17400 }],
  biasProse: "sweep the overnight low then reclaim",
  biasCall: "bull",
};

function trade(o: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    side: "long",
    level: "ONL",
    reason: "reclaim",
    fills: [],
    avgEntry: 17365,
    exitPrice: 17450,
    exitReason: "target",
    exitMethod: "clean",
    size: 1,
    initialStop: 17345,
    riskPoints: 20,
    maePoints: 8,
    mfePoints: 90,
    pnlPoints: 85,
    pnlUsd: 1700,
    commissionUsd: 5,
    rMultiple: 4.25,
    openedAt: 100,
    closedAt: 340,
    ...o,
  };
}

test("buildDigest folds proximity, bias alignment, and session totals", () => {
  const bars = [bar(0, 17561, 17600, 17300, 17561), bar(1, 17561, 17800, 17300, 17700)];
  const structure = classifyStructure(bars, CFG);
  const card = buildReportCard(
    PREP.markedLevels.map((m) => m.price),
    TRUTH,
    PREP.biasCall,
    structure,
    CFG,
  );
  const win = trade();
  const loss = trade({ id: "t2", side: "short", rMultiple: -1, pnlUsd: -500, avgEntry: 17700 });
  const d = buildDigest({
    symbol: "NQ",
    date: "2024-08-05",
    attempt: 1,
    prep: PREP,
    journal: "chased the reclaim",
    trades: [win, loss],
    structure,
    reportCard: card,
  });
  assert.equal(d.session.tradeCount, 2);
  assert.equal(d.session.winCount, 1);
  assert.equal(d.session.netR, 3.25);
  assert.equal(d.session.netUsd, 1200);
  // Long trade agrees with the bull call; the short does not.
  assert.equal(d.trades[0].alignedWithBias, true);
  assert.equal(d.trades[1].alignedWithBias, false);
  // Nearest mark to entry 17365 is the 17360 mark → 5 pts.
  assert.equal(d.trades[0].entryProximityToMark, 5);
  assert.equal(d.journal, "chased the reclaim");
  assert.equal(d.reportCard.bias.called, "bull");
});

test("buildGradeRequest targets Sonnet with the three-axis schema and the digest", () => {
  const structure = classifyStructure([bar(0, 100, 200, 100, 180)], CFG);
  const card = buildReportCard([18400], TRUTH, "bull", structure, CFG);
  const d = buildDigest({
    symbol: "NQ",
    date: "2024-08-05",
    attempt: 1,
    prep: PREP,
    journal: "",
    trades: [trade()],
    structure,
    reportCard: card,
  });
  const req = buildGradeRequest(d) as any;
  assert.equal(req.model, "claude-sonnet-5");
  assert.equal(req.output_config.format.type, "json_schema");
  assert.deepEqual(
    req.output_config.format.schema.required,
    ["planAdherence", "execution", "outcome", "summary"],
  );
  assert.ok(String(req.messages[0].content).includes('"symbol": "NQ"'));
});

test("parseAiGrade extracts and clamps the structured reply", () => {
  const reply = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          planAdherence: { score: 82, notes: "held the plan" },
          execution: { score: 120, notes: "over range" }, // clamps to 100
          outcome: { score: -5, notes: "under range" }, // clamps to 0
          summary: "solid process",
        }),
      },
    ],
  };
  const g = parseAiGrade(reply);
  assert.equal(g.planAdherence.score, 82);
  assert.equal(g.execution.score, 100);
  assert.equal(g.outcome.score, 0);
  assert.equal(g.summary, "solid process");
});

test("parseAiGrade throws on a response with no text block", () => {
  assert.throws(() => parseAiGrade({ content: [{ type: "thinking" }] }));
});

test("fold reconstructs prep and the sealed grade from the event log", () => {
  const structure = classifyStructure([bar(0, 100, 200, 100, 180)], CFG);
  const card = buildReportCard([18400], TRUTH, "bull", structure, CFG);
  const ai = {
    planAdherence: { score: 70, notes: "" },
    execution: { score: 60, notes: "" },
    outcome: { score: 90, notes: "" },
    summary: "ok",
  };
  const log: RecordedEvent[] = [
    { type: "session_started", symbol: "NQ", date: "2024-08-05", attempt: 1, seq: 1, t: 0, at: "" },
    { type: "prep_committed", hash: "abc", prep: PREP, seq: 2, t: 0, at: "" },
    { type: "grade_computed", reportCard: card, aiGrade: ai, seq: 3, t: 7200, at: "" },
  ];
  const state = fold(log);
  assert.deepEqual(state.prep, PREP);
  assert.ok(state.grade);
  assert.equal(state.grade!.aiGrade!.outcome.score, 90);
  assert.equal(state.grade!.reportCard.bias.called, "bull");
});

process.on("exit", () => {
  if (!process.exitCode) console.log(`\n${passed} grade tests passed`);
});
