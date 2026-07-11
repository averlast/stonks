import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import type { Sec1Bar, Candle, Timeframe } from "./types";
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
import {
  SessionRecorder,
  startTauriSession,
  memorySink,
  type PersistSink,
} from "./session/recorder";
import type { Prep } from "./session/events";
import { foldDay } from "./review/review";
import { LevelMarker } from "./prep/levelMarker";

/** A revealed true pre-session level (from the Rust `load_levels` answer key). */
interface TrueLevel {
  id: string;
  label: string;
  kind: string;
  price: number;
}

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

/** Prep-context bars (prior day + overnight) for the Prep chart; [] in browser
 *  dev (Tauri-only source), so the prep chart just degrades to empty (#7). */
async function loadPresession(symbol: string, date: string): Promise<Sec1Bar[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<Sec1Bar[]>("load_presession", { symbol, date });
  } catch (err) {
    console.warn("no prep-context bars", err);
    return [];
  }
}

/** The true pre-session levels revealed on commit; [] in browser dev (#7). */
async function loadTrueLevels(symbol: string, date: string): Promise<TrueLevel[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<TrueLevel[]>("load_levels", { symbol, date });
  } catch (err) {
    console.warn("no levels answer key", err);
    return [];
  }
}

async function main(): Promise<void> {
  const feed = await loadFeed();
  const engine = new PlaybackEngine(feed);

  const chart = new ChartView(document.getElementById("chart")!);
  let activeTf: Timeframe = 60;

  // --- Phase (ADR-0003 Prep gate → attempt → ADR-0002 Review unlock) --------
  // The day opens locked in `prep`; committing the plan unlocks the `attempt`;
  // conceding it (flatten/end-of-day) opens `review` with the whole day handed
  // over. Trading is live only in `attempt`.
  type Phase = "prep" | "attempt" | "review";
  let phase: Phase = "prep";
  let prepBars: Sec1Bar[] = [];
  const reviewHistory = new Map<Timeframe, Candle[]>();

  // --- Fill engine (the integrity layer, SPEC §4) ---------------------------
  const fills = new FillEngine(CONTRACTS.NQ, DEFAULT_FILL_CONFIG);
  if (isTauri()) {
    // Resolve straddled seconds from the Rust tick cache (ADR-0004).
    fills.setStraddleResolver(async (t) => {
      try {
        return await invoke<number[]>("ticks_for_second", { t });
      } catch {
        return null; // → pessimistic fallback
      }
    });
  }
  let lastBar: Sec1Bar | null = null;
  fills.onClosed(() => {
    renderTrades();
    renderMarkers();
    syncControls(); // leaves manage mode now that we're flat
  });

  // --- Session seal (event-sourced record, ADR-0005 / #5) -------------------
  // Under Tauri we open a fresh, distinct attempt file in the tracked repo (the
  // app's first write path); in browser dev the log lives in memory only.
  let attempt = 1;
  let sink: PersistSink = memorySink;
  if (isTauri()) {
    try {
      const started = await startTauriSession(feed.meta.symbol, feed.meta.date);
      attempt = started.attempt;
      sink = started.sink;
    } catch (err) {
      console.error("session start failed; recording to memory only", err);
    }
  }
  const recorder = new SessionRecorder(
    { symbol: feed.meta.symbol, date: feed.meta.date, attempt },
    sink,
  );
  recorder.start();
  recorder.attach(fills); // every place/fill/stop-move/close now lands in the log
  // prep_committed is emitted for real when the trader commits the Prep gate below.

  // --- DOM refs --------------------------------------------------------------
  const $ = (id: string) => document.getElementById(id)!;
  const playBtn = $("play") as HTMLButtonElement;
  const stepBtn = $("step") as HTMLButtonElement;
  const reviewBtn = $("review") as HTMLButtonElement;
  const speedWrap = $("speeds");
  const tfWrap = $("timeframes");
  const clockEl = $("clock");
  const priceEl = $("price");
  const progressEl = $("progress");
  const titleEl = $("title");

  titleEl.textContent = `${feed.meta.symbol} · ${feed.meta.date} · attempt ${attempt}`;

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
    if (phase === "prep") {
      // Prep shows the prior-day + overnight context, folded to this timeframe.
      chart.setData(foldDay(prepBars, tf));
    } else if (phase === "review") {
      // The whole day is unlocked: show every candle, freely pannable both ways.
      chart.setData(reviewHistory.get(tf)!);
    } else {
      // Rebuild from PAST candles only + the current forming one — no future bars.
      chart.setData(engine.historyOf(tf));
      const forming = engine.formingOf(tf);
      if (forming) chart.updateForming(forming);
    }
    renderMarkers(); // marker bucket-times are timeframe-relative
    chart.fitContent();
    syncTfButtons();
  }

  /** Concede the attempt and enter Review: drop the wall, fold the full day into
   *  every timeframe, and lock trading. The full 2h is now scrubbable both ways
   *  (native chart pan over the complete dataset), trades annotated (#6). */
  async function enterReview(): Promise<void> {
    if (phase === "review") return;
    const prev = phase;
    phase = "review";
    engine.pause();
    let bars: Sec1Bar[];
    try {
      await feed.unlockReview();
      bars = await feed.reviewBars();
    } catch (err) {
      console.error("review unlock failed", err);
      phase = prev;
      return;
    }
    reviewHistory.clear();
    for (const tf of TIMEFRAMES) reviewHistory.set(tf, foldDay(bars, tf));
    chart.setData(reviewHistory.get(activeTf)!);
    renderMarkers();
    chart.fitContent();
    renderTrades();
    // Lock the attempt: transport + trading are done.
    playBtn.disabled = true;
    playBtn.textContent = "■ Review";
    stepBtn.disabled = true;
    reviewBtn.disabled = true;
    for (const b of speedBtns.values()) b.disabled = true;
    ticketEl.hidden = true; // trading is done; keep the reveal panel visible
    syncControls();
    titleEl.textContent =
      `${feed.meta.symbol} · ${feed.meta.date} · attempt ${attempt} · REVIEW`;
  }

  // --- Engine subscription ---------------------------------------------------
  engine.subscribe(
    async (tick) => {
      const c = tick.forming.get(activeTf)!;
      chart.updateForming(c);
      // Adjudicate this 1s bar through the fill engine, in clock order (ADR-0002).
      await fills.onBar(tick.simSecond);
      lastBar = tick.simSecond;

      clockEl.textContent = fmtClock(tick.simSecond.t);
      priceEl.textContent = tick.simSecond.c.toFixed(2);
      progressEl.textContent = `${tick.index} / ${feed.meta.count}`;
      renderPosition();
      renderMarkers();
      syncControls();
    },
    () => {
      // 11:30 reached (ADR-0005 / #5): cancel any resting order, auto-flatten any
      // open position with exit reason end-of-day, seal the attempt, then unlock
      // Review (#6).
      fills.cancelPending();
      if (fills.openPosition && lastBar) fills.flatten(lastBar, "end-of-day");
      recorder.endOfDay(lastBar ? lastBar.t : 0);
      renderPosition();
      void enterReview();
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
  const placeBtn = $("place") as HTMLButtonElement;
  const flattenBtn = $("flatten") as HTMLButtonElement;
  const cancelOrderBtn = $("cancelOrder") as HTMLButtonElement;
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
    if (phase !== "attempt") return; // locked in prep, over in review
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
      syncControls();
    } catch (err) {
      ticketMsg.textContent = String(err instanceof Error ? err.message : err);
    }
  });

  flattenBtn.onclick = () => {
    if (lastBar) fills.flatten(lastBar);
  };
  cancelOrderBtn.onclick = () => {
    fills.cancelPending();
    syncControls();
  };
  // Keyboard: F flattens the open position (unless typing in the ticket).
  window.addEventListener("keydown", (e) => {
    const el = document.activeElement;
    const typing = el?.tagName === "INPUT" || el?.tagName === "SELECT";
    if (phase === "attempt" && !typing && (e.key === "f" || e.key === "F") && fills.openPosition && lastBar) {
      fills.flatten(lastBar);
    }
  });

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

  editor.onChange((d) => {
    if (!d) {
      rrEl.textContent = "";
      return;
    }
    if (editor.editMode === "manage") {
      // Live trade management: apply the dragged stop/target immediately (OCO,
      // R still anchored to the initial stop). Takes effect next bar.
      fills.modifyBracket({ stop: d.stop, target: d.target });
      renderPosition();
      const p = fills.openPosition;
      if (p) rrEl.textContent = `managing · stop ${p.stop.toFixed(2)} · tgt ${p.target.toFixed(2)}`;
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
    syncControls();
  };
  cancelDrawBtn.onclick = () => {
    editor.cancel();
    rrEl.textContent = "";
    syncControls();
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
      editor.cancel(); // leave placement; manage mode re-attaches once filled
      rrEl.textContent = "";
      renderPosition();
      syncControls();
    } catch (err) {
      ticketMsg.textContent = String(err instanceof Error ? err.message : err);
    }
  };

  // --- Trading render helpers ------------------------------------------------
  const posBox = $("posBox");
  const tradesBox = $("tradesBox");
  const nq = CONTRACTS.NQ;

  /** One place that reconciles all trade controls with engine state. */
  function syncControls(): void {
    const pos = fills.openPosition;
    const pend = fills.pendingEntry;

    if (phase !== "attempt") {
      // Prep (not yet started) or Review (sealed): no placement/editing/flatten.
      if (editor.active) editor.cancel();
      chart.setBracket({ entry: null, stop: null, target: null });
      drawBtn.disabled = true;
      placeBtn.disabled = true;
      flattenBtn.disabled = true;
      cancelOrderBtn.hidden = true;
      armBtn.hidden = true;
      cancelDrawBtn.hidden = true;
      return;
    }

    // Attach/detach the on-chart manage overlay as the position opens/closes,
    // without disturbing an in-progress placement draw.
    if (pos && editor.editMode === null) {
      editor.manage(pos.side, pos.avgEntry, pos.stop, pos.target);
    } else if (!pos && editor.editMode === "manage") {
      editor.cancel();
    }

    const placing = editor.editMode === "place";
    // The draggable overlay owns the live/placement bracket; horizontal price-
    // lines only draw a resting (unfilled) order.
    if (editor.active) chart.setBracket({ entry: null, stop: null, target: null });
    else if (pend)
      chart.setBracket({ entry: pend.entryPrice ?? null, stop: pend.stop, target: pend.target });
    else chart.setBracket({ entry: null, stop: null, target: null });

    drawBtn.hidden = placing;
    placeBtn.hidden = placing;
    drawBtn.disabled = Boolean(pos || pend);
    placeBtn.disabled = Boolean(pos || pend);
    armBtn.hidden = !placing;
    cancelDrawBtn.hidden = !placing;
    cancelOrderBtn.hidden = !pend;
    flattenBtn.disabled = pos === null;
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
          `<span class="${cls}">$${t.pnlUsd.toFixed(0)}</span></div>` +
          `<div class="trade-mfe muted">MAE ${t.maePoints.toFixed(2)} · MFE ${t.mfePoints.toFixed(2)}</div>`
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
  syncControls();

  // --- Prep gate (#7 / ADR-0003) --------------------------------------------
  const prepPanel = $("prepPanel");
  const prepForm = $("prepForm");
  const prepTitle = $("prepTitle");
  const addLevelBtn = $("addLevel") as HTMLButtonElement;
  const prepLevelsBox = $("prepLevels");
  const biasProseEl = $("biasProse") as HTMLTextAreaElement;
  const biasCallSeg = $("biasCall");
  const commitPrepBtn = $("commitPrep") as HTMLButtonElement;
  const prepMsg = $("prepMsg");
  const prepReveal = $("prepReveal");
  const ticketEl = $("ticket");

  const marker = new LevelMarker(chart, CONTRACTS.NQ.tickSize);
  let biasCall: Prep["biasCall"] | null = null;

  for (const b of biasCallSeg.querySelectorAll("button")) {
    b.addEventListener("click", () => {
      biasCall = (b as HTMLButtonElement).dataset.v as Prep["biasCall"];
      for (const x of biasCallSeg.querySelectorAll("button")) x.classList.remove("active");
      b.classList.add("active");
    });
  }

  function renderPrepLevels(): void {
    const marks = marker.marksList;
    if (marks.length === 0) {
      prepLevelsBox.innerHTML = `<div class="muted">no marks yet — Add level, then drag</div>`;
      return;
    }
    prepLevelsBox.innerHTML = "";
    for (const m of marks) {
      const row = document.createElement("div");
      row.className = "prep-level-row";
      row.innerHTML = `<span>${m.price.toFixed(2)}</span>`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "✕";
      rm.onclick = () => marker.remove(m.id);
      row.appendChild(rm);
      prepLevelsBox.appendChild(row);
    }
  }
  marker.onChange(renderPrepLevels);
  renderPrepLevels();

  // Seed a new mark near the middle of the visible prep candles.
  const prepSeed = (): number => {
    if (prepBars.length) {
      const mid = prepBars[Math.floor(prepBars.length / 2)];
      return (mid.h + mid.l) / 2;
    }
    return 0;
  };
  addLevelBtn.onclick = () => marker.add(prepSeed());

  function renderReveal(truth: TrueLevel[], marks: number[]): void {
    prepReveal.hidden = false;
    if (truth.length === 0) {
      prepReveal.innerHTML = `<h4>Levels revealed</h4><div class="muted">answer key unavailable (dev)</div>`;
      return;
    }
    const rows = truth
      .map((l) => {
        const nearest = marks.length
          ? Math.min(...marks.map((m) => Math.abs(m - l.price)))
          : null;
        const prox = nearest === null ? "not marked" : `nearest ${nearest.toFixed(2)} pts`;
        return `<div class="reveal-row"><span>${l.id} ${l.price.toFixed(2)}</span><span class="muted">${prox}</span></div>`;
      })
      .join("");
    prepReveal.innerHTML = `<h4>Levels revealed</h4>${rows}`;
  }

  async function commitPrep(): Promise<void> {
    if (phase !== "prep") return;
    if (!biasCall) {
      prepMsg.textContent = "call the bias (bull / bear / chop) first";
      return;
    }
    const prep: Prep = {
      markedLevels: marker.prices.map((price) => ({ price })),
      biasProse: biasProseEl.value.trim(),
      biasCall,
    };
    // Freeze the plan (event-sourced seal, immutable) at the current sim second.
    recorder.commitPrep(prep, lastBar ? lastBar.t : 0);
    marker.disable();

    // Reveal the true levels as persistent reference lines + a proximity readout.
    const truth = await loadTrueLevels(feed.meta.symbol, feed.meta.date);
    chart.setLevelLines(truth.map((l) => ({ label: l.id, price: l.price })));
    renderReveal(truth, prep.markedLevels.map((m) => m.price));

    // Unlock the attempt: drop the prep chart, swap to the live RTH feed.
    phase = "attempt";
    marker.destroy();
    chart.setData(engine.historyOf(activeTf)); // empty; playback fills it forward
    chart.fitContent();
    syncPhase();
  }
  commitPrepBtn.onclick = () => void commitPrep();

  /** Reconcile phase-scoped chrome: prep panel vs ticket, transport lock, title. */
  function syncPhase(): void {
    prepForm.hidden = phase !== "prep";
    prepPanel.hidden = phase === "prep" ? false : prepReveal.hidden; // keep reveal visible
    ticketEl.hidden = phase !== "attempt";
    if (phase === "prep") {
      playBtn.disabled = true;
      stepBtn.disabled = true;
      reviewBtn.disabled = true;
      prepTitle.textContent = "Prep — the day opens locked";
      titleEl.textContent = `${feed.meta.symbol} · ${feed.meta.date} · attempt ${attempt} · PREP`;
    } else if (phase === "attempt") {
      playBtn.disabled = false;
      stepBtn.disabled = false;
      reviewBtn.disabled = false;
      prepTitle.textContent = "Prep — committed";
      titleEl.textContent = `${feed.meta.symbol} · ${feed.meta.date} · attempt ${attempt}`;
    }
    syncControls();
  }

  // Enter Prep: show the prior-day + overnight context to mark against.
  prepBars = await loadPresession(feed.meta.symbol, feed.meta.date);
  if (prepBars.length) {
    chart.setData(foldDay(prepBars, activeTf));
    chart.fitContent();
  }
  marker.start();
  syncPhase();

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
  reviewBtn.onclick = () => {
    // Concede the attempt early: flatten flat, seal, and unlock Review. This is a
    // one-way door — you can't peek the rest of the day and then keep trading.
    fills.cancelPending();
    if (fills.openPosition && lastBar) fills.flatten(lastBar);
    void enterReview();
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
