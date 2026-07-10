import "./style.css";
import type { Timeframe } from "./types";
import { DevJsonFeed } from "./engine/barFeed";
import { PlaybackEngine, TIMEFRAMES, type Speed } from "./engine/playback";
import { ChartView } from "./chart/chartView";

const TF_LABEL: Record<Timeframe, string> = { 60: "1m", 300: "5m", 900: "15m" };
const SPEEDS: Speed[] = [1, 5, 30];
const DATA_URL = "/data/NQ-2024-08-05.json";

async function main(): Promise<void> {
  const feed = new DevJsonFeed();
  await feed.load(DATA_URL);
  const engine = new PlaybackEngine(feed);

  const chart = new ChartView(document.getElementById("chart")!);
  let activeTf: Timeframe = 60;

  // --- DOM refs --------------------------------------------------------------
  const $ = (id: string) => document.getElementById(id)!;
  const playBtn = $("play") as HTMLButtonElement;
  const stepBtn = $("step") as HTMLButtonElement;
  const speedWrap = $("speeds");
  const tfWrap = $("timeframes");
  const clockEl = $("clock");
  const priceEl = $("price");
  const progressEl = $("progress");
  const titleEl = $("title");

  titleEl.textContent = `${feed.meta.symbol} · ${feed.meta.date}`;

  // --- Speed + timeframe buttons --------------------------------------------
  const speedBtns = new Map<Speed, HTMLButtonElement>();
  for (const s of SPEEDS) {
    const b = document.createElement("button");
    b.textContent = `${s}×`;
    b.onclick = () => {
      engine.setSpeed(s);
      syncSpeedButtons();
    };
    speedWrap.appendChild(b);
    speedBtns.set(s, b);
  }
  const tfBtns = new Map<Timeframe, HTMLButtonElement>();
  for (const tf of TIMEFRAMES) {
    const b = document.createElement("button");
    b.textContent = TF_LABEL[tf];
    b.onclick = () => switchTimeframe(tf);
    tfWrap.appendChild(b);
    tfBtns.set(tf, b);
  }

  function syncSpeedButtons(): void {
    for (const [s, b] of speedBtns) b.classList.toggle("active", s === engine.speed);
  }
  function syncTfButtons(): void {
    for (const [tf, b] of tfBtns) b.classList.toggle("active", tf === activeTf);
  }

  function switchTimeframe(tf: Timeframe): void {
    activeTf = tf;
    // Rebuild from PAST candles only + the current forming one — no future bars.
    chart.setData(engine.historyOf(tf));
    const forming = engine.formingOf(tf);
    if (forming) chart.updateForming(forming);
    chart.fitContent();
    syncTfButtons();
  }

  // --- Engine subscription ---------------------------------------------------
  engine.subscribe(
    (tick) => {
      const c = tick.forming.get(activeTf)!;
      chart.updateForming(c);
      clockEl.textContent = fmtClock(tick.simSecond.t);
      priceEl.textContent = tick.simSecond.c.toFixed(2);
      progressEl.textContent = `${tick.index} / ${feed.meta.count}`;
    },
    () => {
      playBtn.textContent = "■ End of day";
      playBtn.disabled = true;
      stepBtn.disabled = true;
    },
  );

  // --- Transport controls ----------------------------------------------------
  playBtn.onclick = () => {
    if (engine.playing) {
      engine.pause();
      playBtn.textContent = "▶ Play";
    } else {
      engine.play();
      playBtn.textContent = "❚❚ Pause";
    }
  };
  stepBtn.onclick = () => {
    void engine.step(); // single-bar step, forward-only
  };

  engine.setSpeed(1);
  syncSpeedButtons();
  syncTfButtons();
}

function fmtClock(t: number): string {
  // `t` is exchange-local wall clock encoded as a UTC epoch, so read it as UTC.
  return new Date(t * 1000).toISOString().slice(11, 19);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="color:#ef5350;padding:1rem">${String(err)}</pre>`,
  );
});
