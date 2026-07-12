/* Headless tests for the playback core. Run: npm test (tsx).
 * Covers the two things that actually carry risk (SPEC §7 / ADR-0006):
 *   1. 1s -> multi-timeframe folding + sealing is correct.
 *   2. Speed changes NOTHING about which bars get processed (ADR-0002).
 */
import assert from "node:assert/strict";
import type { Sec1Bar } from "../types";
import { bucketStart, TimeframeAggregator } from "./aggregator";
import { PlaybackEngine, TIMEFRAMES, type Speed } from "./playback";
import { foldDay } from "../review/review";
import type { BarFeed } from "./barFeed";

const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Sec1Bar =>
  ({ t, o, h, l, c, v });

class ArrayFeed implements BarFeed {
  private i = 0;
  meta = { symbol: "TEST", date: "1970-01-01", count: 0 };
  constructor(private bars: Sec1Bar[]) {
    this.meta.count = bars.length;
  }
  async next(): Promise<Sec1Bar | null> {
    return this.i < this.bars.length ? this.bars[this.i++] : null;
  }
  reset(): void {
    this.i = 0;
  }
  async unlockReview(): Promise<void> {}
  async reviewBars(): Promise<Sec1Bar[]> {
    return this.bars.slice();
  }
}

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

// --- bucketStart ------------------------------------------------------------
await test("bucketStart floors to timeframe boundary", () => {
  assert.equal(bucketStart(125, 60), 120);
  assert.equal(bucketStart(125, 300), 0);
  assert.equal(bucketStart(905, 900), 900);
  assert.equal(bucketStart(900, 900), 900);
});

// --- folding + sealing ------------------------------------------------------
await test("1m aggregator folds OHLCV and seals on bucket roll", () => {
  const agg = new TimeframeAggregator(60);
  assert.equal(agg.push(bar(0, 100, 100, 100, 100, 1)).sealed, null);
  assert.equal(agg.push(bar(1, 100, 102, 99, 101, 1)).sealed, null);
  const r3 = agg.push(bar(2, 101, 101, 97, 98, 1));
  assert.equal(r3.sealed, null);
  assert.deepEqual(r3.forming, { time: 0, open: 100, high: 102, low: 97, close: 98, volume: 3 });

  const r4 = agg.push(bar(60, 98, 99, 98, 99, 5)); // opens next bucket
  assert.deepEqual(r4.sealed, { time: 0, open: 100, high: 102, low: 97, close: 98, volume: 3 });
  assert.deepEqual(r4.forming, { time: 60, open: 98, high: 99, low: 98, close: 99, volume: 5 });
});

await test("15m aggregator keeps one candle across many 1m rolls", () => {
  const agg = new TimeframeAggregator(900);
  for (let t = 0; t < 900; t++) agg.push(bar(t, 10 + t, 10 + t, 10, 10 + t, 1));
  const c = agg.current!;
  assert.equal(c.time, 0);
  assert.equal(c.open, 10);
  assert.equal(c.high, 10 + 899);
  assert.equal(c.low, 10);
  assert.equal(c.close, 10 + 899);
  assert.equal(c.volume, 900);
});

// --- determinism under speed (ADR-0002 invariant) --------------------------
function synth(n: number): Sec1Bar[] {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: Sec1Bar[] = [];
  let px = 17500;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = px + (rnd() - 0.5) * 20;
    out.push(bar(1722850200 + i, o, Math.max(o, c) + rnd() * 5, Math.min(o, c) - rnd() * 5, c, 1 + (i % 7)));
    px = c;
  }
  return out;
}

async function runToEnd(bars: Sec1Bar[], speeds: Speed[]): Promise<PlaybackEngine> {
  const eng = new PlaybackEngine(new ArrayFeed(bars));
  let k = 0;
  while (await eng.step()) eng.setSpeed(speeds[k++ % speeds.length]);
  return eng;
}

await test("every bar is processed exactly once regardless of speed", async () => {
  const bars = synth(1000);
  const slow = await runToEnd(bars, [1]);
  const jittery = await runToEnd(bars, [1, 30, 5, 30, 1]);

  assert.equal(slow.index, 1000, "processed count");
  assert.equal(jittery.index, 1000, "processed count under changing speed");
  assert.ok(slow.ended && jittery.ended);

  for (const tf of TIMEFRAMES) {
    const a = slow.historyOf(tf);
    const b = jittery.historyOf(tf);
    assert.equal(a.length, b.length, `history len ${tf}`);
    assert.deepEqual(a, b, `identical sealed history ${tf}`);
  }
  // 1000s spanning ~16.6 minutes -> 16 sealed 1m candles (the 17th is still forming).
  assert.equal(slow.historyOf(60).length, 16);
});

// --- #9: live multi-timeframe fold == independent reference aggregation ------
// The UI renders each timeframe from `historyOf(tf)` (sealed) + `formingOf(tf)`
// (the live right-most candle). This must equal, at EVERY sim-second, a fold of
// exactly the bars processed so far — no more (that would leak future price,
// ADR-0002), no less. `foldDay` is the independent reference (it re-buckets a
// flat bar list from scratch), so a step-by-step deep-equal proves criterion 3
// for all three co-primary timeframes at once.
await test("every timeframe matches a reference aggregation at every second", async () => {
  const bars = synth(1000);
  const eng = new PlaybackEngine(new ArrayFeed(bars));
  const processed: Sec1Bar[] = [];
  let n = 0;
  while (await eng.step()) {
    processed.push(bars[n++]);
    for (const tf of TIMEFRAMES) {
      const forming = eng.formingOf(tf);
      const live = [...eng.historyOf(tf), ...(forming ? [forming] : [])];
      assert.deepEqual(live, foldDay(processed, tf), `tf ${tf} @ second ${n}`);
    }
  }
  assert.equal(n, 1000);
});

// --- #9: switching timeframe mid-attempt preserves the forward-only wall -----
// A switch mid-attempt reads exactly the same clock-bounded state, so the chart
// it would draw can never contain a candle past the sim clock — even for a 15m
// bucket that is still forming while minutes of future price remain hidden.
await test("a mid-attempt timeframe switch shows no bar beyond the sim clock", async () => {
  const bars = synth(1000);
  const eng = new PlaybackEngine(new ArrayFeed(bars));
  const stopAt = 733; // an arbitrary mid-attempt second, mid-bucket on every tf
  for (let i = 0; i < stopAt; i++) await eng.step();
  const lastT = bars[stopAt - 1].t;
  const processed = bars.slice(0, stopAt);
  const fullDay = bars; // what Review would eventually reveal

  for (const tf of TIMEFRAMES) {
    // Exactly the reconstruction switchTimeframe() performs for the attempt.
    const forming = eng.formingOf(tf);
    const shown = [...eng.historyOf(tf), ...(forming ? [forming] : [])];
    // No candle may open on or after the bucket the clock is still filling.
    const clockBucket = bucketStart(lastT, tf);
    for (const c of shown) assert.ok(c.time <= clockBucket, `tf ${tf}: future candle ${c.time}`);
    // It equals the reference fold of the seen bars, and is strictly less than
    // the full-day fold — the wall is intact (future buckets withheld).
    assert.deepEqual(shown, foldDay(processed, tf), `tf ${tf} reconstruction`);
    assert.ok(shown.length < foldDay(fullDay, tf).length, `tf ${tf}: day not fully revealed`);
  }
});

console.log(`\n${passed} passed`);
