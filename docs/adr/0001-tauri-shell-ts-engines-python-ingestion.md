# Tauri desktop shell, TypeScript engines, isolated Python ingestion

## Status
accepted

## Context & decision
We need a cross-platform (macOS + Windows) local-first app whose data model depends on
three filesystem/native capabilities: git-tracked per-day JSON records sitting in the repo
folder (decision 12), native DuckDB scanning months of 1s bars in milliseconds (decision 6),
and an occasional Databento fetch. A pure browser SPA loses all three to the sandbox
(File System Access is Chromium-only, OPFS is invisible to git, DuckDB-WASM has a memory
ceiling, no git, no subprocess). We therefore build the app as a **Tauri** shell (thin Rust
glue for filesystem, git, native DuckDB, and subprocess) with the entire frontend and both
integrity engines — **playback** and **fill** — written in **portable TypeScript** so they
run identically on desktop and on a future mobile/PWA target. Charting is Lightweight Charts.

**Databento ingestion is deliberately NOT part of the runtime.** Bars are a disposable local
cache (decisions 12–13); the app only ever *reads* Parquet. So ingestion is an isolated
offline **Python** script using Databento's first-class SDK (`metadata.get_cost`,
`timeseries.get_range`, DBN decoding) that writes Parquet. This keeps the Python SDK where
it is strongest without coupling the app to Python.

## Considered options
- **Plain localhost browser SPA** — simplest to start, but the browser sandbox fights all
  three data-model requirements (git-tracked files on disk, native DuckDB, calling Python).
- **Electron + Python sidecar** — heavier packaging, no benefit for single-user local.
- **Pure-Python desktop app** — would push charting/engines away from the portable web stack
  and foreclose the mobile/PWA path.

## Consequences
- One-time Rust toolchain + thin Tauri command glue; per-platform native builds.
- Data access sits behind an interface; the desktop adapter reads local Parquet. A future
  hosted-data adapter is the path to mobile — see the deferred mobile note (reopens
  decisions 11 & 13 when taken).
