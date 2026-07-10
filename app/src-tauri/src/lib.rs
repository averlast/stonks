mod bars;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use bars::Sec1Bar;
use serde::Serialize;
use tauri::State;

/// The day's bars plus a forward-only cursor. The webview never gets a handle to
/// `bars` — only one second at a time through `next_sim_second` (ADR-0002).
#[derive(Default)]
struct Feed {
    bars: Vec<Sec1Bar>,
    /// second -> ordered prints, for ambiguous-bar resolution (ADR-0004).
    ticks: HashMap<i64, Vec<f64>>,
    cursor: usize,
    loaded: Option<(String, String)>, // (symbol, date)
}

impl Feed {
    fn set_day(&mut self, bars: Vec<Sec1Bar>, symbol: String, date: String) {
        self.bars = bars;
        self.cursor = 0;
        self.loaded = Some((symbol, date));
    }

    /// The gate: hand back only the next unseen second, then advance. Once the
    /// cursor passes the end it returns None forever (until reset) — it can never
    /// reach backwards or ahead.
    fn next(&mut self) -> Option<Sec1Bar> {
        let i = self.cursor;
        if i >= self.bars.len() {
            return None;
        }
        self.cursor = i + 1;
        Some(self.bars[i])
    }

    fn reset(&mut self) {
        self.cursor = 0;
    }
}

struct AppState(Mutex<Feed>);

#[derive(Serialize)]
struct DayMeta {
    symbol: String,
    date: String,
    count: usize,
}

/// Dev-time bars root: repo/data/bars, relative to this crate. A bundled build
/// will resolve this from an app data dir instead (deferred; slice-0 is dev-run).
fn bars_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/bars")
}

#[tauri::command]
fn load_day(symbol: String, date: String, state: State<AppState>) -> Result<DayMeta, String> {
    let path = bars_dir()
        .join(&symbol)
        .join(format!("{date}_ohlcv-1s.parquet"));
    let loaded = bars::load_parquet(&path).map_err(|e| e.to_string())?;
    let count = loaded.len();

    // Ticks are optional: without them, straddles fall back to pessimistic (#3).
    let ticks_path = bars_dir()
        .join(&symbol)
        .join(format!("{date}_trades.parquet"));
    let ticks = if ticks_path.exists() {
        match bars::load_ticks(&ticks_path) {
            Ok(m) => m,
            Err(e) => {
                log::warn!("tick cache load failed ({e}); straddles will be pessimistic");
                HashMap::new()
            }
        }
    } else {
        HashMap::new()
    };
    log::info!("load_day {symbol} {date}: {count} bars, {} tick-seconds", ticks.len());

    let mut feed = state.0.lock().unwrap();
    feed.set_day(loaded, symbol.clone(), date.clone());
    feed.ticks = ticks;
    Ok(DayMeta { symbol, date, count })
}

/// The gated feed: returns only the NEXT unseen second, or null at end of day.
/// Future bars are physically absent from the frontend until the cursor reaches
/// them — the no-peek wall (decision 6) enforced in Rust, not by UX convention.
#[tauri::command]
fn next_sim_second(state: State<AppState>) -> Option<Sec1Bar> {
    state.0.lock().unwrap().next()
}

/// Rewind the cursor (dev/testing convenience; the real attempt wall is one-way,
/// so this stays until the Review phase's free-scrub unlock is built).
#[tauri::command]
fn reset_feed(state: State<AppState>) {
    state.0.lock().unwrap().reset();
}

/// Ordered prints for one second, for straddle resolution (ADR-0004). `t` is a
/// second the sim clock has already reached, so this is not a peek. Empty when no
/// tick cache is loaded → the caller keeps the pessimistic fallback.
#[tauri::command]
fn ticks_for_second(t: i64, state: State<AppState>) -> Vec<f64> {
    state.0.lock().unwrap().ticks.get(&t).cloned().unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(Feed::default())))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_day,
            next_sim_second,
            reset_feed,
            ticks_for_second
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synth(n: i64) -> Vec<Sec1Bar> {
        (0..n)
            .map(|i| Sec1Bar { t: 1000 + i, o: 1.0, h: 2.0, l: 0.5, c: 1.5, v: 1 })
            .collect()
    }

    #[test]
    fn feed_gates_one_second_at_a_time_in_order() {
        let mut feed = Feed::default();
        feed.set_day(synth(3), "NQ".into(), "2024-08-05".into());

        // Hands back each second exactly once, in order.
        assert_eq!(feed.next().unwrap().t, 1000);
        assert_eq!(feed.next().unwrap().t, 1001);
        assert_eq!(feed.next().unwrap().t, 1002);
        // End of day: None, and it never wraps or peeks.
        assert!(feed.next().is_none());
        assert!(feed.next().is_none());
        // Reset rewinds to the top (dev-only affordance).
        feed.reset();
        assert_eq!(feed.next().unwrap().t, 1000);
    }

    #[test]
    fn loads_the_whipsaw_day_parquet() {
        let path = bars_dir().join("NQ").join("2024-08-05_ohlcv-1s.parquet");
        if !path.exists() {
            eprintln!("skipping: {} not present (run ingestion first)", path.display());
            return;
        }
        let bars = bars::load_parquet(&path).expect("load parquet");
        assert!(bars.len() > 7000, "expected ~7188 bars, got {}", bars.len());
        assert_eq!(bars[0].t, 1_722_850_200, "first bar is 09:30:00 ET");
        assert!(bars.windows(2).all(|w| w[0].t <= w[1].t), "bars are time-ordered");
    }

    #[test]
    fn loads_tick_cache_in_print_order() {
        let path = bars_dir().join("NQ").join("2024-08-05_trades.parquet");
        if !path.exists() {
            eprintln!("skipping: {} not present (run ingestion --no-ticks off)", path.display());
            return;
        }
        let ticks = bars::load_ticks(&path).expect("load ticks");
        let open = ticks.get(&1_722_850_200).expect("09:30:00 second present");
        assert!(open.len() > 100, "open second has many prints, got {}", open.len());
        // Open second knifed down: first print near the high, last near the low —
        // proves the cache preserves true within-second order for resolution.
        assert!((open[0] - 17561.75).abs() < 1.0, "first print near open, got {}", open[0]);
        assert!(
            (open[open.len() - 1] - 17533.75).abs() < 1.0,
            "last print near the low, got {}",
            open[open.len() - 1],
        );
    }
}
