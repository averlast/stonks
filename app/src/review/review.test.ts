/* Tests for Review's full-day fold (#6). Run: npm test. The whole day must fold
 * into the complete candle series so it can be scrubbed both directions. */
import assert from "node:assert/strict";
import type { Sec1Bar } from "../types";
import { foldDay } from "./review";

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

test("folds a day into every 1m candle incl. the final forming bucket", () => {
  // 90 one-second bars from 09:30:00 → two full 1m candles + a partial third.
  const bars: Sec1Bar[] = [];
  for (let i = 0; i < 150; i++) bars.push(bar(1_722_850_200 + i, 100, 101, 99, 100));
  const candles = foldDay(bars, 60);
  assert.equal(candles.length, 3); // 60 + 60 + 30 seconds
  assert.equal(candles[0].time, 1_722_850_200);
  assert.equal(candles[1].time, 1_722_850_260);
  assert.equal(candles[2].time, 1_722_850_320);
});

test("OHLC of a folded candle spans its whole minute", () => {
  const bars = [
    bar(1_722_850_200, 100, 105, 98, 101),
    bar(1_722_850_201, 101, 110, 100, 108),
    bar(1_722_850_202, 108, 109, 95, 96),
  ];
  const [c] = foldDay(bars, 60);
  assert.equal(c.open, 100);
  assert.equal(c.high, 110);
  assert.equal(c.low, 95);
  assert.equal(c.close, 96);
});

test("an empty day folds to no candles", () => {
  assert.deepEqual(foldDay([], 60), []);
});

process.on("exit", () => {
  if (!process.exitCode) console.log(`\n${passed} review tests passed`);
});
