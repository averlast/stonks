import { defineConfig } from "vite";

// Vite config tuned for the Tauri dev webview. The webview must never spuriously
// full-reload: a reload races Tauri's `__TAURI_INTERNALS__` injection and silently
// drops the app into browser-dev mode (isTauri() → false, so the gated feed and
// prep-context bars stop loading and the chart goes blank).
//
// The main culprit with the default config is Vite's dependency pre-bundling:
// when it discovers a not-yet-optimized dep at runtime it re-optimizes and issues
// a full reload. Pre-declaring the runtime deps here means they're bundled up
// front, so no mid-session reload happens.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Rust rebuilds must not trigger a frontend reload.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  optimizeDeps: {
    include: ["@tauri-apps/api/core", "lightweight-charts"],
  },
});
