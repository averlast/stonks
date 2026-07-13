/* Tests for the fill engine — the integrity layer (SPEC §4). Run: npm test.
 * Every #3 acceptance criterion has a case here. Fills must never be more
 * optimistic than reality. */
import assert from "node:assert/strict";
import type { Sec1Bar } from "../types";
import { CONTRACTS, type FillConfig } from "./contracts";
import { FillEngine, type BracketRequest } from "./fillEngine";
import type { ConfirmationFlags } from "./confirmation";

const bar = (t: number, o: number, h: number, l: number, c: number): Sec1Bar =>
  ({ t, o, h, l, c, v: 1 });

const CFG: FillConfig = { slippageTicks: 1, commissionPerContract: 2.5 }; // slip = 0.25
const engine = () => new FillEngine(CONTRACTS.NQ, CFG);

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
const approx = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const LONG = (o: Partial<BracketRequest> = {}): BracketRequest => ({
  side: "long",
  entryType: "market",
  stop: 100,
  target: 110,
  size: 1,
  ...o,
});

// --- entries ----------------------------------------------------------------
test("market entry fills at next bar open + slippage", () => {
  const e = engine();
  e.place(LONG(), 0);
  e.onBar(bar(1, 105, 106, 104, 105));
  approx(e.openPosition!.avgEntry, 105.25); // 105 + 1 tick
});

test("limit entry fills clean on trade-through", () => {
  const e = engine();
  e.place(LONG({ entryType: "limit", entryPrice: 104 }), 0);
  e.onBar(bar(1, 105, 106, 103.5, 105)); // dips through 104
  approx(e.openPosition!.avgEntry, 104); // no slippage on a limit
});

test("stop-entry fills at stop price + slippage", () => {
  const e = engine();
  e.place(LONG({ entryType: "stop", entryPrice: 106, target: 112 }), 0);
  e.onBar(bar(1, 105, 106.5, 104, 106)); // trades up through 106
  approx(e.openPosition!.avgEntry, 106.25);
});

// --- exits + OCO ------------------------------------------------------------
test("target exit closes clean; OCO cancels the stop", () => {
  const e = engine();
  e.place(LONG(), 0);
  e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25
  e.onBar(bar(2, 105, 111, 104, 110)); // hits target 110 (not stop 100)
  assert.equal(e.trades.length, 1);
  assert.equal(e.trades[0].exitReason, "target");
  approx(e.trades[0].exitPrice, 110);
  // Sibling stop is gone: a later stop-level bar produces no second trade.
  e.onBar(bar(3, 100, 100, 99, 99));
  assert.equal(e.trades.length, 1);
  assert.equal(e.openPosition, null);
});

test("stop exit fills at stop minus slippage", () => {
  const e = engine();
  e.place(LONG(), 0);
  e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25
  e.onBar(bar(2, 105, 106, 99, 100)); // breaks stop 100
  assert.equal(e.trades[0].exitReason, "stop");
  approx(e.trades[0].exitPrice, 99.75); // 100 - 1 tick
});

// --- straddle (pessimistic) -------------------------------------------------
test("straddle bar resolves pessimistically (stop first) and is flagged", () => {
  const e = engine();
  e.place(LONG({ stop: 104, target: 107 }), 0);
  e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25
  e.onBar(bar(2, 105, 108, 103, 106)); // touches BOTH stop 104 and target 107
  const tr = e.trades[0];
  assert.equal(tr.exitReason, "stop");
  assert.equal(tr.exitMethod, "pessimistic");
  approx(tr.exitPrice, 103.75); // 104 - 1 tick
});

// --- PnL / commissions / R --------------------------------------------------
test("PnL nets commissions + slippage; R anchors to initial stop", () => {
  const e = engine();
  e.place(LONG({ size: 2, stop: 100, target: 110 }), 0);
  e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25, size 2
  e.onBar(bar(2, 105, 111, 105, 110)); // target 110
  const tr = e.trades[0];
  approx(tr.pnlPoints, 4.75); // 110 - 105.25
  approx(tr.commissionUsd, 10); // 2.5 × 2 contracts × 2 sides
  approx(tr.pnlUsd, 4.75 * 20 * 2 - 10); // 190 - 10 = 180
  approx(tr.riskPoints, 5.25); // 105.25 - 100
  approx(tr.rMultiple, 180 / (5.25 * 20 * 2)); // net $ ÷ 1R$
});

test("a flat stop-out is slightly worse than -1R (slippage + fees are honest)", () => {
  const e = engine();
  // Realistic NQ stop distance (~11pt) so 1 tick + fees are a small drag on -1R.
  e.place(LONG({ stop: 90, target: 130 }), 0);
  e.onBar(bar(1, 101, 101, 101, 101)); // entry 101.25, risk = 11.25pt
  e.onBar(bar(2, 101, 101, 89, 90)); // stopped at 90 → fills 89.75
  const tr = e.trades[0];
  assert.ok(tr.rMultiple < -1, `expected < -1R, got ${tr.rMultiple}`);
  assert.ok(tr.rMultiple > -1.1, `but only slightly, got ${tr.rMultiple}`);
});

// --- MAE / MFE --------------------------------------------------------------
test("MAE/MFE track the whole lifecycle", () => {
  const e = engine();
  e.place(LONG({ stop: 90, target: 130 }), 0);
  e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25
  e.onBar(bar(2, 105, 106, 102, 104)); // adverse to 102
  e.onBar(bar(3, 104, 113, 104, 112)); // favorable to 113
  e.flatten(bar(3, 104, 113, 104, 112));
  const tr = e.trades[0];
  approx(tr.maePoints, 3.25); // 105.25 - 102
  approx(tr.mfePoints, 7.75); // 113 - 105.25
  assert.equal(tr.exitReason, "flatten");
});

// --- short mirror -----------------------------------------------------------
test("short bracket: stop above, target below, mirrored fills", () => {
  const e = engine();
  e.place({ side: "short", entryType: "market", stop: 110, target: 100, size: 1 }, 0);
  e.onBar(bar(1, 105, 105, 105, 105)); // entry 105 - slip = 104.75
  approx(e.openPosition!.avgEntry, 104.75);
  e.onBar(bar(2, 105, 106, 99, 100)); // hits target 100
  approx(e.trades[0].exitPrice, 100);
  approx(e.trades[0].pnlPoints, 4.75); // 104.75 - 100
});

// --- live trade management --------------------------------------------------
test("modifyBracket trails the stop; R stays anchored to the initial stop", () => {
  const e = engine();
  e.place(LONG({ stop: 100, target: 130 }), 0);
  e.onBar(bar(1, 110, 110, 110, 110)); // entry 110.25, initial risk 10.25pt
  e.modifyBracket({ stop: 110 }); // trail up to ~break-even
  e.onBar(bar(2, 110, 112, 109, 109)); // dips to 109 → trailed stop 110 hit
  const tr = e.trades[0];
  assert.equal(tr.exitReason, "stop");
  approx(tr.exitPrice, 109.75); // 110 - 1 tick
  approx(tr.initialStop, 100); // untouched
  approx(tr.riskPoints, 10.25); // R still measured off the initial stop
  assert.ok(tr.rMultiple > -0.1 && tr.rMultiple < 0, `near break-even, got ${tr.rMultiple}`);
});

// --- guards -----------------------------------------------------------------
test("only one active bracket at a time", () => {
  const e = engine();
  e.place(LONG(), 0);
  assert.throws(() => e.place(LONG(), 0), /already active/);
});

test("rejects an inverted bracket", () => {
  const e = engine();
  assert.throws(() => e.place(LONG({ stop: 110, target: 100 }), 0), /stop < target/);
});

// --- tick-resolution of straddles (#4) --------------------------------------
async function atest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n`, e);
    process.exitCode = 1;
  }
}

// Same straddle bar, opposite true print order → opposite honest outcome.
const STRADDLE = () => LONG({ stop: 104, target: 107 });

await atest("straddle resolves target-first from true prints (tick-true)", async () => {
  const e = engine();
  e.setStraddleResolver(async () => [105.5, 106, 107.25, 103.5]); // up through 107 first
  e.place(STRADDLE(), 0);
  await e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25
  await e.onBar(bar(2, 105, 108, 103, 106)); // range touches both
  const tr = e.trades[0];
  assert.equal(tr.exitReason, "target");
  assert.equal(tr.exitMethod, "tick-true");
  approx(tr.exitPrice, 107);
});

await atest("straddle resolves stop-first from true prints (tick-true)", async () => {
  const e = engine();
  e.setStraddleResolver(async () => [104.75, 103.5, 105, 107.5]); // down through 104 first
  e.place(STRADDLE(), 0);
  await e.onBar(bar(1, 105, 105, 105, 105));
  await e.onBar(bar(2, 105, 108, 103, 106));
  const tr = e.trades[0];
  assert.equal(tr.exitReason, "stop");
  assert.equal(tr.exitMethod, "tick-true");
  approx(tr.exitPrice, 103.75);
});

await atest("straddle falls back to pessimistic when ticks are unavailable", async () => {
  const e = engine();
  e.setStraddleResolver(async () => null);
  e.place(STRADDLE(), 0);
  await e.onBar(bar(1, 105, 105, 105, 105));
  await e.onBar(bar(2, 105, 108, 103, 106));
  assert.equal(e.trades[0].exitMethod, "pessimistic");
  assert.equal(e.trades[0].exitReason, "stop");
});

// --- confirmation flags + setup tag (#10) -----------------------------------
await atest("the confirmation provider stamps flags at entry; tag + flags ride to the trade", async () => {
  const e = engine();
  const flags: ConfirmationFlags = {
    fiveMinCloseBeyond: true,
    volumeIncrease: false,
    engulfing: true,
    withHtfTrend: true,
    htfTrend: "up",
  };
  let seen: { side: string; entryPrice: number; t: number } | null = null;
  e.setConfirmationProvider((ctx) => {
    seen = ctx;
    return flags;
  });
  e.place(LONG({ setupTag: "sweep-reversal" }), 0);
  await e.onBar(bar(1, 105, 105, 105, 105)); // market entry at 105 + 1 tick

  // The provider saw the actual fill price and side.
  assert.equal(seen!.side, "long");
  approx(seen!.entryPrice, 105.25);
  // Stamped onto the live position...
  assert.deepEqual(e.openPosition!.confirmation, flags);
  assert.equal(e.openPosition!.setupTag, "sweep-reversal");

  await e.onBar(bar(2, 105, 111, 104, 110)); // target
  const tr = e.trades[0];
  assert.deepEqual(tr.confirmation, flags); // ...and carried onto the closed trade
  assert.equal(tr.setupTag, "sweep-reversal");
});

await atest("no provider → the trade still closes with confirmation undefined", async () => {
  const e = engine();
  e.place(LONG(), 0);
  await e.onBar(bar(1, 105, 105, 105, 105));
  await e.onBar(bar(2, 105, 111, 104, 110));
  assert.equal(e.trades[0].confirmation, undefined);
  assert.equal(e.trades[0].setupTag, undefined);
});

// --- scale-in / scale-out lifecycle (#11) -----------------------------------

// Scale in: add to an open position; running size grows, avg entry re-weights,
// and 1R stays anchored to the FIRST entry's risk (adds don't rewrite it).
await atest("scale-in: adds re-weight avg entry and running size; 1R unchanged", async () => {
  const e = engine();
  e.place(LONG({ size: 1, stop: 100, target: 130 }), 0);
  await e.onBar(bar(1, 110, 110, 110, 110)); // first entry 110.25, size 1
  approx(e.openPosition!.avgEntry, 110.25);
  approx(e.openPosition!.size, 1);

  e.addToPosition({ entryType: "market", size: 1 }, 1);
  await e.onBar(bar(2, 114, 114, 114, 114)); // add fills 114.25, size 1
  const p = e.openPosition!;
  approx(p.size, 2); // running size
  approx(p.avgEntry, (110.25 + 114.25) / 2); // 112.25, size-weighted
  approx(p.firstEntryPrice, 110.25); // anchor untouched

  await e.onBar(bar(3, 114, 131, 114, 130)); // crosses target 130 — closes BOTH
  const tr = e.trades[0];
  approx(tr.size, 2); // total contracts traded
  approx(tr.avgEntry, 112.25);
  approx(tr.exitPrice, 130); // single target covers the scaled-in size
  approx(tr.pnlPoints, 130 - 112.25); // 17.75 per contract
  approx(tr.commissionUsd, 2.5 * 4); // 2 entries + 2 exits, one side each
  approx(tr.pnlUsd, 17.75 * 20 * 2 - 10);
  // 1R = FIRST entry risk: initial size 1 × |110.25 - 100| × $20 (adds don't rewrite it).
  approx(tr.riskPoints, 10.25);
  approx(tr.rMultiple, tr.pnlUsd / (10.25 * 20 * 1));
  assert.equal(tr.entryCount, 2);
  assert.equal(tr.exitCount, 1);
});

// Regression (#11): a plain single target must protect scale-ins — hitting it
// closes the WHOLE position, not just the initial size (else the add is a naked
// runner). Only explicit staged targets keep fixed leg sizes.
await atest("a single target covers the scaled-in size (adds stay protected)", async () => {
  const e = engine();
  e.place(LONG({ size: 1, stop: 100, target: 110 }), 0);
  await e.onBar(bar(1, 105, 105, 105, 105)); // entry ×1
  e.addToPosition({ entryType: "market", size: 2 }, 1);
  await e.onBar(bar(2, 105, 105, 105, 105)); // add ×2 → size 3
  approx(e.openPosition!.size, 3);
  await e.onBar(bar(3, 105, 111, 105, 110)); // target 110
  assert.equal(e.openPosition, null, "the whole position closes at the target");
  assert.equal(e.trades.length, 1);
  approx(e.trades[0].size, 3); // all three contracts exited at the target
  assert.equal(e.trades[0].exitReason, "target");
});

// Scale out manually: take a partial off at market, the runner exits later — all
// inside one Trade, with a size-weighted average exit.
await atest("scale-out: manual partial then runner, one Trade, avg exit", async () => {
  const e = engine();
  e.place(LONG({ size: 2, stop: 100, target: 130 }), 0);
  await e.onBar(bar(1, 110, 110, 110, 110)); // entry 110.25 × 2
  e.reducePosition(1, bar(2, 120, 120, 120, 120)); // sell 1 at market 120 - slip
  assert.equal(e.trades.length, 0); // still open — runner remains
  approx(e.openPosition!.size, 1);
  await e.onBar(bar(3, 120, 131, 120, 130)); // runner hits target 130
  const tr = e.trades[0];
  assert.equal(tr.exitCount, 2);
  approx(tr.exitPrice, (119.75 + 130) / 2); // size-weighted avg of the two exits
  approx(tr.size, 2);
  approx(tr.pnlPoints, (119.75 + 130) / 2 - 110.25);
});

// Staged targets (TP1/TP2/runner): each leg fills at its price; the stop covers
// the remaining size after partials.
await atest("staged targets fill leg-by-leg; trailed stop takes the runner", async () => {
  const e = engine();
  e.place(
    LONG({
      size: 3,
      stop: 100,
      target: 130,
      targets: [
        { price: 112, size: 1 }, // TP1
        { price: 118, size: 1 }, // TP2
        { price: 130, size: 1 }, // runner
      ],
    }),
    0,
  );
  await e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25 × 3
  await e.onBar(bar(2, 105, 113, 105, 112)); // clears TP1 (112) only
  approx(e.openPosition!.size, 2);
  await e.onBar(bar(3, 112, 118, 112, 117)); // clears TP2 (118)
  approx(e.openPosition!.size, 1);
  e.modifyBracket({ stop: 115 }); // trail to lock the runner
  await e.onBar(bar(4, 117, 117, 114, 114)); // runner stopped at 115
  assert.equal(e.trades.length, 1);
  const tr = e.trades[0];
  assert.equal(tr.exitReason, "stop"); // the runner's exit is the headline
  assert.equal(tr.exitCount, 3);
  approx(tr.size, 3);
  approx(tr.exitPrice, (112 + 118 + 114.75) / 3); // 115 - 1 tick on the runner
});

// A bar that clears a partial target AND the stop resolves by true print order:
// the partial fills first, the runner is stopped after.
await atest("straddle with a partial: target-first tick order fills partial then stops runner", async () => {
  const e = engine();
  e.setStraddleResolver(async () => [113, 99]); // TP1 prints, THEN the stop
  e.place(
    LONG({
      size: 2,
      stop: 100,
      target: 120,
      targets: [
        { price: 112, size: 1 },
        { price: 120, size: 1 },
      ],
    }),
    0,
  );
  await e.onBar(bar(1, 105, 105, 105, 105)); // entry 105.25 × 2
  await e.onBar(bar(2, 105, 113, 98, 100)); // range touches TP1 112 AND stop 100
  const tr = e.trades[0];
  assert.equal(tr.exitCount, 2);
  approx(tr.size, 2);
  // TP1 partial at 112 (tick-true), runner stopped at 99.75 (100 - 1 tick).
  approx(tr.exitPrice, (112 + 99.75) / 2);
  assert.equal(tr.exitReason, "stop"); // the stop took the position flat
});

// MAE/MFE span the whole scaled lifecycle, not a single leg.
await atest("MAE/MFE track the whole scaled lifecycle", async () => {
  const e = engine();
  e.place(LONG({ size: 2, stop: 80, target: 200 }), 0);
  await e.onBar(bar(1, 100, 100, 100, 100)); // entry 100.25 × 2
  await e.onBar(bar(2, 100, 101, 95, 96)); // adverse to 95
  e.addToPosition({ entryType: "market", size: 1 }, 2);
  await e.onBar(bar(3, 97, 120, 97, 118)); // add fills 97.25; favorable to 120
  e.flatten(bar(3, 97, 120, 97, 118));
  const tr = e.trades[0];
  // MAE off the pre-add avg (100.25): 100.25 - 95 = 5.25.
  approx(tr.maePoints, 5.25);
  assert.ok(tr.mfePoints > 19, `MFE spans the runup, got ${tr.mfePoints}`);
  assert.equal(tr.exitReason, "flatten");
});

// Guards around the position lifecycle.
test("cannot add without an open position; cannot double-work an add", () => {
  const e = engine();
  assert.throws(() => e.addToPosition({ entryType: "market", size: 1 }, 0), /no open position/);
});

// Retarget a specific staged leg on a live position (drag TP2 on the chart, #11).
await atest("modifyTarget retargets one staged leg by a stable index", async () => {
  const e = engine();
  e.place(
    LONG({
      size: 2,
      stop: 100,
      target: 120,
      targets: [
        { price: 112, size: 1 }, // index 0 — TP1
        { price: 120, size: 1 }, // index 1 — runner
      ],
    }),
    0,
  );
  await e.onBar(bar(1, 105, 105, 105, 105)); // entry ×2
  e.modifyTarget(1, 116); // drag the runner down to 116
  approx(e.openPosition!.targets[1].price, 116);
  await e.onBar(bar(2, 105, 113, 105, 112)); // TP1 fills, index 0 removed
  approx(e.openPosition!.size, 1);
  // The runner is now index 0; retarget it again and fill it there.
  assert.equal(e.openPosition!.targets.length, 1);
  e.modifyTarget(0, 118);
  await e.onBar(bar(3, 116, 119, 116, 118)); // hits the retargeted 118
  const tr = e.trades[0];
  assert.equal(e.openPosition, null);
  approx(tr.exitPrice, (112 + 118) / 2);
  assert.equal(tr.exitReason, "target");
});

// Several working adds can rest at once (add on a pullback OR a breakout), and each
// fills independently against the bar stream (order-centric scaling, #11).
await atest("multiple working adds can rest and each fills independently", async () => {
  const e = engine();
  e.place(LONG({ size: 1, stop: 100, target: 200 }), 0);
  await e.onBar(bar(1, 110, 110, 110, 110)); // entry ×1 @ 110.25
  e.addToPosition({ entryType: "limit", entryPrice: 108, size: 1 }, 1); // add on a dip
  e.addToPosition({ entryType: "stop", entryPrice: 114, size: 1 }, 1); // add on a break
  assert.equal(e.workingAdds.length, 2);
  await e.onBar(bar(2, 110, 110, 107, 108)); // dips to 108 → limit add fills
  approx(e.openPosition!.size, 2);
  assert.equal(e.workingAdds.length, 1);
  await e.onBar(bar(3, 112, 115, 112, 114)); // breaks 114 → stop add fills
  approx(e.openPosition!.size, 3);
  assert.equal(e.workingAdds.length, 0);
});

// Scale out by resting an ordinary take-profit limit (the real-platform way to
// build TP1/TP2): it fills only its own size, leaving the runner working.
await atest("placeReduceLimit rests a partial take-profit that fills at its price", async () => {
  const e = engine();
  e.place(LONG({ size: 2, stop: 100, target: 130 }), 0); // full-cover target at 130
  await e.onBar(bar(1, 105, 105, 105, 105)); // entry ×2 @ 105.25
  e.placeReduceLimit(115, 1, 1); // TP1: sell 1 @ 115
  await e.onBar(bar(2, 105, 116, 105, 114)); // trades through 115 → TP1 fills 1
  approx(e.openPosition!.size, 1);
  await e.onBar(bar(3, 114, 131, 114, 130)); // runner hits the full-cover target
  const tr = e.trades[0];
  assert.equal(tr.exitCount, 2);
  approx(tr.exitPrice, (115 + 130) / 2);
});

console.log(`\n${passed} passed`);
