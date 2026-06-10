import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from /WebSharkDataStudio/.
// DuckDB-WASM and Pyodide are loaded from CDN at runtime, so no special
// COOP/COEP headers are needed (we deliberately use the single-threaded,
// non-cross-origin-isolated builds — see src/engine/duck.ts).
export default defineConfig({
  base: '/WebSharkDataStudio/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // apache-arrow + duckdb-wasm bundle better when pre-bundled.
    exclude: ['@duckdb/duckdb-wasm'],
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
  },
})
