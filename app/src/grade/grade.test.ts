/* Tests for the grade slice (#8). Run: npm test. The report card must classify the
 * bias call deterministically from the sealed 2h window, and the AI request/response
 * plumbing must build and parse without a network. (Level-marking precision-scoring
 * was removed — marks are a Prep ritual, not a graded drill.) */
import assert from "node:assert/strict";
import type { Sec1Bar } from "../types";
import type { Trade } from "../engine/fillEngine";
import type { Prep } from "../session/events";
import { fold, type RecordedEvent } from "../session/events";
import { buildReportCard, classifyStructure, scoreBias } from "./reportCard";
import { buildDigest } from "./digest";
import { buildGradeRequest, parseAiGrade } from "./grade";
import { gradeConfig } from "./types";

const CFG = gradeConfig("NQ"); // directional fraction 0.34
const bar = (t: number, o: number, h: number, l: number, c: number): Sec1Bar =>
  ({ t, o, h, l, c, v: 1 });

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
    entryCount: 1,
    exitCount: 1,
    openedAt: 100,
    closedAt: 340,
    ...o,
  };
}

test("buildDigest folds proximity, bias alignment, and session totals", () => {
  const bars = [bar(0, 17561, 17600, 17300, 17561), bar(1, 17561, 17800, 17300, 17700)];
  const structure = classifyStructure(bars, CFG);
  const card = buildReportCard(PREP.biasCall, structure);
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

test("buildDigest carries each trade's setup tag and confirmation flags (#10)", () => {
  const structure = classifyStructure([bar(0, 100, 200, 100, 180)], CFG);
  const card = buildReportCard("bull", structure);
  const tagged = trade({
    setupTag: "sweep-reversal",
    confirmation: {
      fiveMinCloseBeyond: true,
      volumeIncrease: false,
      engulfing: true,
      withHtfTrend: true,
      htfTrend: "up",
    },
  });
  const d = buildDigest({
    symbol: "NQ",
    date: "2024-08-05",
    attempt: 1,
    prep: PREP,
    journal: "",
    trades: [tagged],
    structure,
    reportCard: card,
  });
  assert.equal(d.trades[0].setupTag, "sweep-reversal");
  assert.equal(d.trades[0].confirmation!.withHtfTrend, true);
  assert.equal(d.trades[0].confirmation!.htfTrend, "up");
  // ...and they survive into the prompt string the model receives.
  const req = buildGradeRequest(d) as any;
  assert.ok(String(req.messages[0].content).includes("sweep-reversal"));
});

test("buildGradeRequest targets Sonnet with the three-axis schema and the digest", () => {
  const structure = classifyStructure([bar(0, 100, 200, 100, 180)], CFG);
  const card = buildReportCard("bull", structure);
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
  const card = buildReportCard("bull", structure);
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
