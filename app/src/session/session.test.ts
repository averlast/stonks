/* Tests for the Session event log — the seal (ADR-0005 / #5). Run: npm test.
 * State must be reconstructable purely by folding the typed event stream, and a
 * committed prep must carry a stable, tamper-evident hash. */
import assert from "node:assert/strict";
import type { Sec1Bar } from "../types";
import { CONTRACTS, type FillConfig } from "../engine/contracts";
import { FillEngine, type BracketRequest } from "../engine/fillEngine";
import { fold, hashPrep, type PrepStub, type RecordedEvent } from "./events";
import { SessionRecorder, memorySink } from "./recorder";

const bar = (t: number, o: number, h: number, l: number, c: number): Sec1Bar =>
  ({ t, o, h, l, c, v: 1 });
const CFG: FillConfig = { slippageTicks: 1, commissionPerContract: 2.5 };
const LONG = (o: Partial<BracketRequest> = {}): BracketRequest => ({
  side: "long",
  entryType: "market",
  stop: 100,
  target: 110,
  size: 1,
  ...o,
});

function harness() {
  const engine = new FillEngine(CONTRACTS.NQ, CFG);
  const rec = new SessionRecorder({ symbol: "NQ", date: "2024-08-05", attempt: 1 }, memorySink);
  rec.attach(engine);
  rec.start();
  rec.commitPrep({ stub: true, symbol: "NQ", date: "2024-08-05" });
  return { engine, rec };
}
const types = (log: readonly RecordedEvent[]) => log.map((e) => e.type);

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.then(
        () => {
          passed++;
          console.log(`  ok  ${name}`);
        },
        (e) => {
          console.error(`FAIL  ${name}\n`, e);
          process.exitCode = 1;
        },
      );
    } else {
      passed++;
      console.log(`  ok  ${name}`);
    }
  } catch (e) {
    console.error(`FAIL  ${name}\n`, e);
    process.exitCode = 1;
  }
}

// --- the fold is the source of truth ----------------------------------------
test("a full trade folds back into the sealed tape", async () => {
  const { engine, rec } = harness();
  engine.place(LONG(), 0);
  await engine.onBar(bar(1, 105, 106, 104, 105)); // entry fill
  await engine.onBar(bar(2, 105, 111, 104, 110)); // hits target 110

  const st = rec.state;
  assert.equal(st.symbol, "NQ");
  assert.equal(st.attempt, 1);
  assert.equal(st.prepHash !== null, true, "prep hash sealed");
  assert.equal(st.trades.length, 1, "one sealed trade");
  assert.equal(st.trades[0].exitReason, "target");
  // The tape is a pure fold — a fresh fold of the raw log must match.
  assert.deepEqual(fold(rec.log), st);
});

test("event stream carries every attempt moment, in order", async () => {
  const { engine, rec } = harness();
  engine.place(LONG(), 0);
  await engine.onBar(bar(1, 105, 106, 104, 105)); // entry fill
  engine.modifyBracket({ stop: 103 }); // trail the stop
  await engine.onBar(bar(2, 105, 107, 104, 106)); // stop_moved logged here
  await engine.onBar(bar(3, 106, 111, 105, 110)); // target
  assert.deepEqual(types(rec.log), [
    "session_started",
    "prep_committed",
    "order_placed",
    "fill", // entry
    "stop_moved",
    "fill", // target exit
    "trade_closed",
  ]);
  // seq is strictly increasing write order.
  assert.deepEqual(
    rec.log.map((e) => e.seq),
    [1, 2, 3, 4, 5, 6, 7],
  );
});

test("a drag (many modifyBracket calls) coalesces to one stop_moved per bar", async () => {
  const { engine, rec } = harness();
  engine.place(LONG(), 0);
  await engine.onBar(bar(1, 105, 106, 104, 105));
  engine.modifyBracket({ stop: 101 });
  engine.modifyBracket({ stop: 102 });
  engine.modifyBracket({ stop: 103 }); // three drag steps, one resting value
  await engine.onBar(bar(2, 105, 107, 104, 106));
  const moves = rec.log.filter((e) => e.type === "stop_moved");
  assert.equal(moves.length, 1);
  assert.equal((moves[0] as Extract<RecordedEvent, { type: "stop_moved" }>).stop, 103);
});

// --- 11:30 auto-flatten seals with reason end-of-day ------------------------
test("end-of-day auto-flatten logs a flatten(cause=end-of-day) + end_of_day", async () => {
  const { engine, rec } = harness();
  engine.place(LONG(), 0);
  const last = bar(1, 105, 106, 104, 105);
  await engine.onBar(last); // entry fill, still open at 11:30
  // Simulate playback onEnd: cancel working orders, auto-flatten, seal.
  engine.cancelPending();
  engine.flatten(last, "end-of-day");
  rec.endOfDay(last.t);

  const flat = rec.log.find((e) => e.type === "flatten");
  assert.ok(flat, "flatten event present");
  assert.equal((flat as Extract<RecordedEvent, { type: "flatten" }>).cause, "end-of-day");
  const st = rec.state;
  assert.equal(st.endOfDay, true);
  assert.equal(st.trades[0].exitReason, "end-of-day");
});

test("cancelling a resting order logs order_cancelled and no trade", async () => {
  const { engine, rec } = harness();
  engine.place(LONG({ entryType: "limit", entryPrice: 90 }), 0); // never fills
  engine.cancelPending();
  assert.deepEqual(types(rec.log), [
    "session_started",
    "prep_committed",
    "order_placed",
    "order_cancelled",
  ]);
  assert.equal(rec.state.trades.length, 0);
});

// --- prep hash is deterministic + tamper-evident ----------------------------
test("prep hash is stable, key-order-independent, and changes on edit", () => {
  const a: PrepStub & Record<string, unknown> = { stub: true, symbol: "NQ", date: "2024-08-05" };
  const reordered: Record<string, unknown> = { date: "2024-08-05", symbol: "NQ", stub: true };
  assert.equal(hashPrep(a), hashPrep(reordered), "canonicalised: key order irrelevant");
  assert.notEqual(hashPrep(a), hashPrep({ ...a, date: "2024-08-06" }), "edit shows a new hash");
});

process.on("exit", () => {
  if (process.exitCode) return;
  console.log(`\n${passed} session tests passed`);
});
