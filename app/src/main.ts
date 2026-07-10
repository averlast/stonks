import "./style.css";
import type { Sec1Bar, Timeframe } from "./types";
import { DevJsonFeed, TauriFeed, isTauri, type BarFeed } from "./engine/barFeed";
import { PlaybackEngine, TIMEFRAMES, type Speed } from "./engine/playback";
import { bucketStart } from "./engine/aggregator";
import { ChartView, type FillMarker } from "./chart/chartView";
import { BracketEditor } from "./trading/bracketEditor";
import { CONTRACTS, DEFAULT_FILL_CONFIG } from "./engine/contracts";
import {
  FillEngine,
  type BracketRequest,
  type Side,
  type EntryType,
  type Fill,
} from "./engine/fillEngine";

const TF_LABEL: Record<Timeframe, string> = { 60: "1m", 300: "5m", 900: "15m" };
const SPEEDS: Speed[] = [1, 5, 30];
const DATA_URL = "/data/NQ-2024-08-05.json";

async function loadFeed(): Promise<BarFeed> {
  // Under Tauri the bars live in Rust behind the gated feed; in a plain browser
  // dev server we fall back to the JSON dump (ADR-0002; dev-only).
  if (isTauri()) {
    const f = new TauriFeed();
    await f.load("NQ", "2024-08-05");
    return f;
  }
  const f = new DevJsonFeed();
  await f.load(DATA_URL);
  return f;
}

async function main(): Promise<void> {
  const feed = await loadFeed();
  const engine = new PlaybackEngine(feed);

  const chart = new ChartView(document.getElementById("chart")!);
  let activeTf: Timeframe = 60;

  // --- Fill engine (the integrity layer, SPEC §4) ---------------------------
  const fills = new FillEngine(CONTRACTS.NQ, DEFAULT_FILL_CONFIG);
  let lastBar: Sec1Bar | null = null;
  fills.onClosed(() => {
    renderTrades();
    renderMarkers();
    updateFlattenBtn();
  });

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
    renderMarkers(); // marker bucket-times are timeframe-relative
    chart.fitContent();
    syncTfButtons();
  }

  // --- Engine subscription ---------------------------------------------------
  engine.subscribe(
    (tick) => {
      const c = tick.forming.get(activeTf)!;
      chart.updateForming(c);
      // Adjudicate this 1s bar through the fill engine, in clock order (ADR-0002).
      fills.onBar(tick.simSecond);
      lastBar = tick.simSecond;

      clockEl.textContent = fmtClock(tick.simSecond.t);
      priceEl.textContent = tick.simSecond.c.toFixed(2);
      progressEl.textContent = `${tick.index} / ${feed.meta.count}`;
      renderPosition();
      updateBracketLines();
      renderMarkers();
      updateFlattenBtn();
    },
    () => {
      playBtn.textContent = "■ End of day";
      playBtn.disabled = true;
      stepBtn.disabled = true;
    },
  );

  // --- Order ticket ----------------------------------------------------------
  const ticket = $("ticket") as HTMLFormElement;
  const sideSeg = $("side");
  const entryTypeEl = $("entryType") as HTMLSelectElement;
  const entryPriceEl = $("entryPrice") as HTMLInputElement;
  const stopEl = $("stop") as HTMLInputElement;
  const targetEl = $("target") as HTMLInputElement;
  const sizeEl = $("size") as HTMLInputElement;
  const flattenBtn = $("flatten") as HTMLButtonElement;
  const ticketMsg = $("ticketMsg");
  let side: Side = "long";

  for (const b of sideSeg.querySelectorAll("button")) {
    b.addEventListener("click", () => {
      side = (b as HTMLButtonElement).dataset.v as Side;
      for (const x of sideSeg.querySelectorAll("button")) x.classList.remove("active");
      b.classList.add("active");
      editor.setSide(side); // keep an in-progress on-chart draft in sync
    });
  }
  const syncEntryPriceEnabled = () => {
    entryPriceEl.disabled = entryTypeEl.value === "market";
  };
  entryTypeEl.addEventListener("change", syncEntryPriceEnabled);
  syncEntryPriceEnabled();

  ticket.addEventListener("submit", (e) => {
    e.preventDefault();
    ticketMsg.textContent = "";
    const entryType = entryTypeEl.value as EntryType;
    const req: BracketRequest = {
      side,
      entryType,
      entryPrice: entryType === "market" ? undefined : Number(entryPriceEl.value),
      stop: Number(stopEl.value),
      target: Number(targetEl.value),
      size: Number(sizeEl.value),
      level: "manual",
      reason: "discretionary",
    };
    try {
      fills.place(req, lastBar ? lastBar.t : 0);
      renderPosition();
      updateBracketLines();
      updateFlattenBtn();
    } catch (err) {
      ticketMsg.textContent = String(err instanceof Error ? err.message : err);
    }
  });

  flattenBtn.onclick = () => {
    if (lastBar) fills.flatten(lastBar);
  };

  // --- On-chart bracket editor ----------------------------------------------
  const editor = new BracketEditor(chart, CONTRACTS.NQ.tickSize);
  const drawBtn = $("draw") as HTMLButtonElement;
  const armBtn = $("arm") as HTMLButtonElement;
  const cancelDrawBtn = $("cancelDraw") as HTMLButtonElement;
  const rrEl = $("rr");

  const seedPrice = (): number | null =>
    lastBar ? lastBar.c : (engine.formingOf(activeTf)?.close ?? null);

  function inferEntryType(s: Side, entry: number, last: number): EntryType {
    if (Math.abs(entry - last) <= CONTRACTS.NQ.tickSize / 2) return "market";
    const above = entry > last;
    return s === "long" ? (above ? "stop" : "limit") : above ? "limit" : "stop";
  }

  function beginDrawUI(on: boolean): void {
    drawBtn.hidden = on;
    (ticket.querySelector("#place") as HTMLElement).hidden = on;
    armBtn.hidden = !on;
    cancelDrawBtn.hidden = !on;
  }

  editor.onChange((d) => {
    if (!d) {
      rrEl.textContent = "";
      return;
    }
    const type = lastBar ? inferEntryType(d.side, d.entry, lastBar.c) : "limit";
    entryTypeEl.value = type;
    syncEntryPriceEnabled();
    entryPriceEl.value = String(d.entry);
    stopEl.value = String(d.stop);
    targetEl.value = String(d.target);
    const risk = Math.abs(d.entry - d.stop);
    const rr = risk > 0 ? Math.abs(d.target - d.entry) / risk : 0;
    rrEl.textContent = `${d.side} · ${type} @ ${d.entry.toFixed(2)} · R:R ${rr.toFixed(2)}`;
  });

  drawBtn.onclick = () => {
    const seed = seedPrice();
    if (seed === null) {
      ticketMsg.textContent = "step or play forward first";
      return;
    }
    ticketMsg.textContent = "";
    editor.start(side, seed);
    beginDrawUI(true);
  };
  cancelDrawBtn.onclick = () => {
    editor.cancel();
    rrEl.textContent = "";
    beginDrawUI(false);
  };
  armBtn.onclick = () => {
    const v = editor.value;
    if (!v) return;
    const type = lastBar ? inferEntryType(v.side, v.entry, lastBar.c) : "limit";
    try {
      fills.place(
        {
          side: v.side,
          entryType: type,
          entryPrice: type === "market" ? undefined : v.entry,
          stop: v.stop,
          target: v.target,
          size: Number(sizeEl.value),
          level: "chart",
          reason: "drawn",
        },
        lastBar ? lastBar.t : 0,
      );
      editor.cancel();
      beginDrawUI(false);
      renderPosition();
      updateBracketLines();
      updateFlattenBtn();
    } catch (err) {
      ticketMsg.textContent = String(err instanceof Error ? err.message : err);
    }
  };

  // --- Trading render helpers ------------------------------------------------
  const posBox = $("posBox");
  const tradesBox = $("tradesBox");
  const nq = CONTRACTS.NQ;

  function updateFlattenBtn(): void {
    flattenBtn.disabled = fills.openPosition === null;
  }

  function updateBracketLines(): void {
    const p = fills.openPosition;
    const pend = fills.pendingEntry;
    if (p) chart.setBracket({ entry: p.avgEntry, stop: p.stop, target: p.target });
    else if (pend)
      chart.setBracket({ entry: pend.entryPrice ?? null, stop: pend.stop, target: pend.target });
    else chart.setBracket({ entry: null, stop: null, target: null });
  }

  function renderMarkers(): void {
    const marks: FillMarker[] = [];
    const push = (f: Fill) => {
      const color =
        f.reason === "target" ? "#26a69a"
        : f.reason === "stop" ? "#ef5350"
        : f.reason === "entry" ? "#3b82f6"
        : "#9ca3af";
      const text =
        f.reason === "entry" ? "E" : f.reason === "target" ? "T" : f.reason === "stop" ? "S" : "X";
      marks.push({ time: bucketStart(f.t, activeTf), above: f.reason !== "entry", color, text });
    };
    for (const tr of fills.trades) for (const f of tr.fills) push(f);
    const p = fills.openPosition;
    if (p) for (const f of p.fills) push(f);
    marks.sort((a, b) => a.time - b.time);
    chart.setFillMarkers(marks);
  }

  function renderPosition(): void {
    const p = fills.openPosition;
    const pend = fills.pendingEntry;
    if (!p && pend) {
      const at = pend.entryPrice != null ? ` @ ${pend.entryPrice}` : "";
      posBox.innerHTML =
        `<h4>Working order</h4>` +
        `<div class="kv"><span class="pos-${pend.side}">${pend.side} ×${pend.size}</span><span>${pend.entryType}${at}</span></div>` +
        `<div class="kv"><span>stop / tgt</span><span>${pend.stop} / ${pend.target}</span></div>`;
      return;
    }
    if (!p) {
      posBox.innerHTML = `<h4>Position</h4><div class="muted">flat</div>`;
      return;
    }
    const last = lastBar ? lastBar.c : p.avgEntry;
    const pnlPts = p.side === "long" ? last - p.avgEntry : p.avgEntry - last;
    const risk = Math.abs(p.avgEntry - p.initialStop);
    const r = risk > 0 ? pnlPts / risk : 0;
    const usd = pnlPts * nq.pointValue * p.size;
    const cls = pnlPts >= 0 ? "pnl-pos" : "pnl-neg";
    posBox.innerHTML =
      `<h4>Position</h4>` +
      `<div class="kv"><span class="pos-${p.side}">${p.side} ×${p.size}</span><span>@ ${p.avgEntry.toFixed(2)}</span></div>` +
      `<div class="kv"><span>stop / tgt</span><span>${p.stop.toFixed(2)} / ${p.target.toFixed(2)}</span></div>` +
      `<div class="kv"><span>unreal</span><span class="${cls}">${r >= 0 ? "+" : ""}${r.toFixed(2)}R · ${usd >= 0 ? "+" : ""}$${usd.toFixed(0)}</span></div>` +
      `<div class="kv"><span>MAE / MFE</span><span>${p.maePoints.toFixed(2)} / ${p.mfePoints.toFixed(2)}</span></div>`;
  }

  function renderTrades(): void {
    const ts = fills.trades;
    if (ts.length === 0) {
      tradesBox.innerHTML = `<h4>Trades</h4><div class="muted">none yet</div>`;
      return;
    }
    let totalR = 0;
    let totalUsd = 0;
    const rows = ts
      .map((t) => {
        totalR += t.rMultiple;
        totalUsd += t.pnlUsd;
        const cls = t.pnlUsd >= 0 ? "pnl-pos" : "pnl-neg";
        const flag = t.exitMethod === "pessimistic" ? " ⚠" : "";
        return (
          `<div class="trade-row"><span class="pos-${t.side}">${t.side}</span>` +
          `<span>${t.exitReason}${flag}</span>` +
          `<span class="${cls}">${t.rMultiple >= 0 ? "+" : ""}${t.rMultiple.toFixed(2)}R</span>` +
          `<span class="${cls}">$${t.pnlUsd.toFixed(0)}</span></div>`
        );
      })
      .join("");
    const tcls = totalUsd >= 0 ? "pnl-pos" : "pnl-neg";
    tradesBox.innerHTML =
      `<h4>Trades (${ts.length})</h4>${rows}` +
      `<div class="trade-row"><span>total</span><span></span>` +
      `<span class="${tcls}">${totalR >= 0 ? "+" : ""}${totalR.toFixed(2)}R</span>` +
      `<span class="${tcls}">$${totalUsd.toFixed(0)}</span></div>`;
  }

  renderPosition();
  renderTrades();
  updateFlattenBtn();

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
