/* Tests for the confirmation flags + setup tags (#10). Run: npm test.
 * The four flags must be deterministic over the sealed 5m/15m candles at entry —
 * same market state, same flags — and degrade to false when history is too thin. */
import assert from "node:assert/strict";
import type { Candle } from "../types";
import {
  computeConfirmation,
  confirmationConfig,
  isSetupTag,
  SETUP_TAGS,
  type ConfirmationConfig,
} from "./confirmation";

const CFG: ConfirmationConfig = confirmationConfig("NQ"); // vol×1.2 over 3, htf 30pt

/** A 5m/15m candle; only OHLC + volume matter to the flags. `time` is nominal. */
const c = (open: number, high: number, low: number, close: number, volume = 1): Candle => ({
  time: 0,
  open,
  high,
  low,
  close,
  volume,
});

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

// --- 5m close beyond the level ---------------------------------------------
test("5m close beyond fires when the last sealed 5m closed past the entry, in-direction", () => {
  const m5 = [c(100, 106, 99, 105)]; // closed 105
  const long = computeConfirmation({ side: "long", entryPrice: 104, m5Sealed: m5, m15Sealed: [], config: CFG });
  assert.equal(long.fiveMinCloseBeyond, true); // 105 > 104
  const short = computeConfirmation({ side: "short", entryPrice: 104, m5Sealed: m5, m15Sealed: [], config: CFG });
  assert.equal(short.fiveMinCloseBeyond, false); // 105 is not below 104
});

test("5m close beyond is false with no sealed 5m candle yet", () => {
  const r = computeConfirmation({ side: "long", entryPrice: 104, m5Sealed: [], m15Sealed: [], config: CFG });
  assert.equal(r.fiveMinCloseBeyond, false);
});

// --- volume increase --------------------------------------------------------
test("volume increase fires when the last 5m volume beats the trailing average × factor", () => {
  const m5 = [c(1, 2, 0, 1, 100), c(1, 2, 0, 1, 100), c(1, 2, 0, 1, 100), c(1, 2, 0, 1, 130)];
  // avg of prior 3 = 100; 130 > 1.2×100 = 120 → increase.
  const r = computeConfirmation({ side: "long", entryPrice: 0, m5Sealed: m5, m15Sealed: [], config: CFG });
  assert.equal(r.volumeIncrease, true);
});

test("volume increase is false for a normal bar and with too little history", () => {
  const flat = [c(1, 2, 0, 1, 100), c(1, 2, 0, 1, 100), c(1, 2, 0, 1, 110)]; // 110 < 120
  assert.equal(
    computeConfirmation({ side: "long", entryPrice: 0, m5Sealed: flat, m15Sealed: [], config: CFG }).volumeIncrease,
    false,
  );
  const thin = [c(1, 2, 0, 1, 999)]; // no prior bar to compare
  assert.equal(
    computeConfirmation({ side: "long", entryPrice: 0, m5Sealed: thin, m15Sealed: [], config: CFG }).volumeIncrease,
    false,
  );
});

// --- engulfing --------------------------------------------------------------
test("bullish engulfing fires for a long when a green body wraps the prior red body", () => {
  const m5 = [c(105, 106, 101, 102), c(101, 108, 100, 107)]; // red then green engulf
  const r = computeConfirmation({ side: "long", entryPrice: 0, m5Sealed: m5, m15Sealed: [], config: CFG });
  assert.equal(r.engulfing, true);
  // Same candles, a short does NOT see a bearish engulfing.
  const s = computeConfirmation({ side: "short", entryPrice: 0, m5Sealed: m5, m15Sealed: [], config: CFG });
  assert.equal(s.engulfing, false);
});

test("engulfing is false when the last body does not wrap the prior body", () => {
  const m5 = [c(105, 106, 101, 102), c(103, 105, 102, 104)]; // green but does not engulf 105→102
  assert.equal(
    computeConfirmation({ side: "long", entryPrice: 0, m5Sealed: m5, m15Sealed: [], config: CFG }).engulfing,
    false,
  );
});

// --- HTF trend --------------------------------------------------------------
test("with-HTF-trend fires when the 15m net clears the threshold in the trade's direction", () => {
  const up = [c(100, 100, 100, 100), c(110, 145, 110, 140)]; // net = 140 − 100 = +40 ≥ 30
  const long = computeConfirmation({ side: "long", entryPrice: 0, m5Sealed: [], m15Sealed: up, config: CFG });
  assert.equal(long.htfTrend, "up");
  assert.equal(long.withHtfTrend, true);
  const short = computeConfirmation({ side: "short", entryPrice: 0, m5Sealed: [], m15Sealed: up, config: CFG });
  assert.equal(short.withHtfTrend, false); // shorting an uptrend is against the HTF
});

test("HTF trend is flat (and never 'with') when the net is inside the threshold", () => {
  const chop = [c(100, 120, 90, 100), c(100, 115, 95, 110)]; // net = +10 < 30
  const r = computeConfirmation({ side: "long", entryPrice: 0, m5Sealed: [], m15Sealed: chop, config: CFG });
  assert.equal(r.htfTrend, "flat");
  assert.equal(r.withHtfTrend, false);
});

// --- determinism ------------------------------------------------------------
test("the same market state always stamps the same flags", () => {
  const m5 = [c(105, 106, 101, 102), c(101, 108, 100, 107, 200), c(101, 108, 100, 107, 400)];
  const m15 = [c(100, 100, 100, 100), c(110, 145, 110, 140)];
  const input = { side: "long" as const, entryPrice: 104, m5Sealed: m5, m15Sealed: m15, config: CFG };
  assert.deepEqual(computeConfirmation(input), computeConfirmation(input));
});

// --- setup vocabulary -------------------------------------------------------
test("the setup vocabulary is the six CONTEXT archetypes and the guard matches it", () => {
  assert.equal(SETUP_TAGS.length, 6);
  assert.ok(isSetupTag("sweep-reversal"));
  assert.ok(!isSetupTag("not-a-setup"));
});

console.log(`\n${passed} passed`);
