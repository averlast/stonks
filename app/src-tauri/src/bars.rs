//! Reads a day's 1-second OHLCV bars from the ingestion Parquet.
//!
//! The `t` column is canonical app time (ET wall clock as epoch seconds), baked
//! in by `ingestion/fetch_day.py`, so no timezone logic lives here.

use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use arrow::array::{Array, Float64Array, Int64Array, UInt64Array};
use arrow::datatypes::DataType;
use arrow::record_batch::RecordBatch;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde::Serialize;

/// One 1-second OHLCV bar. Mirrors the frontend `Sec1Bar` (app/src/types.ts).
#[derive(Clone, Copy, Serialize)]
pub struct Sec1Bar {
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: i64,
}

pub fn load_parquet(path: &Path) -> Result<Vec<Sec1Bar>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let reader = ParquetRecordBatchReaderBuilder::try_new(file)?.build()?;

    let mut bars = Vec::new();
    for batch in reader {
        let batch = batch?;
        let t = col_i64(&batch, "t")?;
        let o = col_f64(&batch, "open")?;
        let h = col_f64(&batch, "high")?;
        let l = col_f64(&batch, "low")?;
        let c = col_f64(&batch, "close")?;
        let v = col_int(&batch, "volume")?;
        for i in 0..batch.num_rows() {
            bars.push(Sec1Bar { t: t[i], o: o[i], h: h[i], l: l[i], c: c[i], v: v[i] });
        }
    }
    // The feed must be strictly time-ordered; row-group order isn't guaranteed.
    bars.sort_by_key(|b| b.t);
    Ok(bars)
}

/// Load the per-day tick cache as `second -> ordered prices` for ambiguous-bar
/// resolution (ADR-0004). The trades Parquet is sorted by `ts`, so pushing in
/// file order preserves true within-second print order. Adjudication-only input:
/// never rendered, never fed to the chart.
pub fn load_ticks(path: &Path) -> Result<HashMap<i64, Vec<f64>>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let reader = ParquetRecordBatchReaderBuilder::try_new(file)?.build()?;

    let mut map: HashMap<i64, Vec<f64>> = HashMap::new();
    for batch in reader {
        let batch = batch?;
        let t = col_i64(&batch, "t")?;
        let price = col_f64(&batch, "price")?;
        for i in 0..batch.num_rows() {
            map.entry(t[i]).or_default().push(price[i]);
        }
    }
    Ok(map)
}

fn col_f64(batch: &RecordBatch, name: &str) -> Result<Vec<f64>> {
    let arr = batch
        .column_by_name(name)
        .ok_or_else(|| anyhow!("missing column {name}"))?;
    let arr = arr
        .as_any()
        .downcast_ref::<Float64Array>()
        .ok_or_else(|| anyhow!("column {name} is not Float64"))?;
    Ok(arr.values().to_vec())
}

fn col_i64(batch: &RecordBatch, name: &str) -> Result<Vec<i64>> {
    let arr = batch
        .column_by_name(name)
        .ok_or_else(|| anyhow!("missing column {name}"))?;
    let arr = arr
        .as_any()
        .downcast_ref::<Int64Array>()
        .ok_or_else(|| anyhow!("column {name} is not Int64"))?;
    Ok(arr.values().to_vec())
}

/// Volume can arrive as Int64 or UInt64 (DuckDB UBIGINT) depending on the writer.
fn col_int(batch: &RecordBatch, name: &str) -> Result<Vec<i64>> {
    let arr = batch
        .column_by_name(name)
        .ok_or_else(|| anyhow!("missing column {name}"))?;
    match arr.data_type() {
        DataType::Int64 => Ok(arr
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap()
            .values()
            .to_vec()),
        DataType::UInt64 => Ok(arr
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap()
            .values()
            .iter()
            .map(|&x| x as i64)
            .collect()),
        other => Err(anyhow!("column {name} unexpected integer type {other:?}")),
    }
}
