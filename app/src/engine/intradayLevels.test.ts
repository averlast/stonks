/* Headless tests for the intraday objective-level engine (#12). Run: npm test (tsx).
 * The engine is auto-drawn but UNSCORED, so the risk is purely arithmetic: the OR/IB
 * windows must open/close on the right seconds, the retracements/extensions must sit
 * where CONTEXT says, VWAP must be volume-weighted, and a grade-time refold must equal
 * the live fold. No look-ahead is structural (forward push only).
 */
import assert from "node:assert/strict";
import type { Sec1Bar } from "../types";
import {
  IntradayLevels,
  foldIntradayLevels,
  foldVwapCurve,
  DEFAULT_INTRADAY_CONFIG,
  type IntradayLevel,
} from "./intradayLevels";

const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Sec1Bar =>
  ({ t, o, h, l, c, v });

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((e) => {
      console.error(`FAIL  ${name}\n`, e);
      process.exitCode = 1;
    });
}

const OPEN = 1_722_850_200; // arbitrary RTH-open epoch (matches the 09:30 anchor role)
const find = (levels: IntradayLevel[], id: string) => levels.find((l) => l.id === id);

// A synthetic day: a rising wedge in the first 15m, a spike-and-fade through the IB,
// then a drift so OR ≠ IB ≠ whole window. Deterministic.
function day(seconds: number): Sec1Bar[] {
  const out: Sec1Bar[] = [];
  for (let i = 0; i < seconds; i++) {
    const t = OPEN + i;
    // base price walks up ~1pt/min, with a controlled OR high at 09:30–09:45.
    let c = 100 + i * 0.01;
    if (i < 900) c = 100 + i * 0.02; // steeper inside the OR
    const h = c + 1;
    const l = c - 1;
    out.push(bar(t, c, h, l, c, 1 + (i % 5)));
  }
  return out;
}

// --- OR window opens/closes on the right seconds ----------------------------
await test("Opening Range spans [open, open+15m) then freezes", () => {
  const il = new IntradayLevels();
  // Push 09:30..09:44:59 — OR still forming, not complete.
  for (let i = 0; i < 900; i++) il.push(bar(OPEN + i, 100 + i, 100 + i + 2, 100 + i - 3, 100 + i, 1));
  assert.equal(il.openRangeComplete, false, "still forming at second 899");
  const mid = il.levels();
  const orhForming = find(mid, "ORH")!;
  assert.equal(orhForming.complete, false);
  // The high seen so far is at i=899: 100+899+2 = 1001. Low at i=0: 100-3 = 97.
  assert.equal(orhForming.price, 1001);
  assert.equal(find(mid, "ORL")!.price, 97);
  assert.equal(find(mid, "OR50")!.price, (1001 + 97) / 2);

  // The bar at dt=900 (09:45:00) closes the OR window; a still-higher high must NOT
  // extend it.
  il.push(bar(OPEN + 900, 5000, 6000, 4000, 5000, 1));
  assert.equal(il.openRangeComplete, true);
  const done = il.levels();
  assert.equal(find(done, "ORH")!.price, 1001, "OR high frozen — the 09:45 spike is excluded");
  assert.equal(find(done, "ORH")!.complete, true);
});

// --- IB develops then freezes at 10:30, retracements/extensions appear -------
await test("IB develops, freezes at 60m, and exposes 25/50/75 + extensions only when complete", () => {
  const il = new IntradayLevels();
  // A clean IB from 100 to 200 over the first hour.
  for (let i = 0; i < 3600; i++) {
    const c = 100 + (i / 3599) * 100; // 100 -> 200
    il.push(bar(OPEN + i, c, c, c, c, 1));
  }
  // Still one second short of complete: edges present, retracements NOT yet.
  let lv = il.levels();
  assert.ok(find(lv, "IBH") && find(lv, "IBL"), "developing edges present");
  assert.equal(find(lv, "IBH")!.complete, false);
  assert.equal(find(lv, "IB50"), undefined, "no retracements while developing");
  assert.equal(find(lv, "IBup0.5"), undefined, "no extensions while developing");

  // Cross the 10:30 boundary — a later spike must not widen the frozen IB.
  il.push(bar(OPEN + 3600, 999, 999, 999, 999, 1));
  assert.equal(il.initialBalanceComplete, true);
  lv = il.levels();
  assert.equal(find(lv, "IBH")!.price, 200);
  assert.equal(find(lv, "IBL")!.price, 100);
  assert.equal(find(lv, "IB25")!.price, 125);
  assert.equal(find(lv, "IB50")!.price, 150);
  assert.equal(find(lv, "IB75")!.price, 175);
  // width 100; extensions at 0.5 and 1.0 beyond each edge.
  assert.equal(find(lv, "IBup0.5")!.price, 250);
  assert.equal(find(lv, "IBdn0.5")!.price, 50);
  assert.equal(find(lv, "IBup1")!.price, 300);
  assert.equal(find(lv, "IBdn1")!.price, 0);
  for (const l of lv.filter((x) => x.group === "IB")) assert.equal(l.complete, true);
});

// --- VWAP is volume-weighted, not a simple mean -----------------------------
await test("VWAP is Σ(typical·vol)/Σvol, anchored at the open", () => {
  const il = new IntradayLevels();
  // Two bars: price 100 on volume 1, price 200 on volume 3. Typical == close here.
  il.push(bar(OPEN, 100, 100, 100, 100, 1));
  il.push(bar(OPEN + 1, 200, 200, 200, 200, 3));
  // (100*1 + 200*3) / (1+3) = 700/4 = 175 — not the 150 arithmetic mean.
  assert.equal(il.vwap, 175);
  assert.equal(il.vwapCurve.length, 2);
  assert.equal(il.vwapCurve[0].value, 100); // after the first bar
});

// --- grade-time refold equals the live fold (no drift) ----------------------
await test("foldIntradayLevels over the sealed day equals a live push", () => {
  const bars = day(4000);
  const live = new IntradayLevels();
  for (const b of bars) live.push(b);
  const refold = foldIntradayLevels(bars);
  assert.deepEqual(refold.levels, live.levels());
  assert.equal(refold.vwap, live.vwap);
  assert.equal(refold.vwapCurve.length, bars.length);
});

// --- VWAP curve folds onto the candle time grid -----------------------------
await test("foldVwapCurve collapses to one point per bucket at bucket-start time", () => {
  const bars = day(200); // 200s -> spans 4 one-minute buckets (0..3)
  const { vwapCurve } = foldIntradayLevels(bars);
  const m1 = foldVwapCurve(vwapCurve, 60);
  // Buckets at OPEN-relative 0,60,120,180 -> 4 points, strictly ascending, aligned.
  assert.equal(m1.length, 4);
  for (let i = 1; i < m1.length; i++) assert.ok(m1[i].time > m1[i - 1].time, "ascending");
  assert.equal(m1[0].time % 60, 0, "bucket-aligned");
  // Each folded point carries the LAST VWAP seen within its bucket.
  const bucket0 = vwapCurve.filter((p) => Math.floor((p.t - vwapCurve[0].t) / 60) === 0);
  assert.equal(m1[0].value, bucket0[bucket0.length - 1].value);
});

// --- empty input is safe ----------------------------------------------------
await test("no bars → no levels, null vwap", () => {
  const snap = foldIntradayLevels([]);
  assert.deepEqual(snap.levels, []);
  assert.equal(snap.vwap, null);
  assert.deepEqual(snap.vwapCurve, []);
  assert.equal(DEFAULT_INTRADAY_CONFIG.orSeconds, 900);
});

console.log(`\n${passed} passed`);
