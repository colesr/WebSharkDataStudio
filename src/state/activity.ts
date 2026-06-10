// ---------------------------------------------------------------------------
// Activity store — a live, rolling log of what the app is doing, plus a global
// "busy" counter that drives the top progress bar and console spinner.
//
// Standalone (no imports from the main store or engines) so any module can emit
// activity without creating an import cycle.
// ---------------------------------------------------------------------------

import { create } from 'zustand'

export type LogLevel = 'info' | 'ok' | 'warn' | 'error'

export interface LogEntry {
  id: number
  ts: number
  msg: string
  level: LogLevel
}

const MAX_ENTRIES = 250
let seq = 0

interface ActivityState {
  log: LogEntry[]
  busy: number
  pushLog: (msg: string, level?: LogLevel) => void
  clearLog: () => void
  beginBusy: () => void
  endBusy: () => void
}

export const useActivity = create<ActivityState>((set) => ({
  log: [],
  busy: 0,
  pushLog: (msg, level = 'info') =>
    set((s) => {
      const entry: LogEntry = { id: ++seq, ts: Date.now(), msg, level }
      const log = s.log.length >= MAX_ENTRIES ? [...s.log.slice(1), entry] : [...s.log, entry]
      return { log }
    }),
  clearLog: () => set({ log: [] }),
  beginBusy: () => set((s) => ({ busy: s.busy + 1 })),
  endBusy: () => set((s) => ({ busy: Math.max(0, s.busy - 1) })),
}))

/** Imperative helpers for non-React code (engines). */
export const logActivity = (msg: string, level: LogLevel = 'info') =>
  useActivity.getState().pushLog(msg, level)

/**
 * Wrap an async task: log its start, mark the app busy, then log completion
 * (with elapsed ms) or the error. Returns the task's result.
 */
export async function withTask<T>(msg: string, fn: () => Promise<T>): Promise<T> {
  const { pushLog, beginBusy, endBusy } = useActivity.getState()
  const t0 = performance.now()
  pushLog(msg, 'info')
  beginBusy()
  try {
    const result = await fn()
    const ms = Math.round(performance.now() - t0)
    pushLog(`✓ ${msg} · ${ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}`, 'ok')
    return result
  } catch (err) {
    pushLog(`✕ ${msg} — ${String((err as Error).message || err)}`, 'error')
    throw err
  } finally {
    endBusy()
  }
}
