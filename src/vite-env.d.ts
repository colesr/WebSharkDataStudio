/// <reference types="vite/client" />

// Pyodide is loaded from CDN at runtime via a dynamic import of an ESM URL.
declare global {
  interface Window {
    loadPyodide?: (config?: { indexURL?: string }) => Promise<any>
  }
}

export {}
