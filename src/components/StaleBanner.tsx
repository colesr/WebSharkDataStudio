import { useState } from 'react'
import { useStore } from '../state/store'
import { runAll, runAllFresh } from '../engine/runtime'
import type { Cell } from '../types'

// A cell needs running if it derives data but isn't up to date: explicitly
// stale (an upstream edit invalidated it) or never produced an output this
// session (idle/error with nothing computed). Chart/profile cells auto-render
// on load, so they're excluded.
function needsRunning(cell: Cell): boolean {
  if (cell.type !== 'sql' && cell.type !== 'python' && cell.type !== 'model') return false
  if (cell.status === 'stale') return true
  if (cell.status === 'running' || cell.status === 'ok') return false
  return !cell.output // idle/error with no computed output
}

export function StaleBanner() {
  const cells = useStore((s) => s.cells)
  const [running, setRunning] = useState<'all' | 'fresh' | null>(null)

  const count = cells.filter(needsRunning).length
  if (count === 0) return null

  async function run(kind: 'all' | 'fresh') {
    setRunning(kind)
    try {
      await (kind === 'fresh' ? runAllFresh() : runAll())
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="stale-banner">
      <span className="dot" />
      <span>
        {count} cell{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} running to be up to date
      </span>
      <span style={{ flex: 1 }} />
      <button className="btn sm" disabled={!!running} onClick={() => run('all')}>
        {running === 'all' ? <span className="spinner" /> : '▷'} Run all
      </button>
      <button
        className="btn sm ghost"
        disabled={!!running}
        title="Reset the engine and re-run top-to-bottom for a clean reproduction"
        onClick={() => run('fresh')}
      >
        {running === 'fresh' ? <span className="spinner" /> : '↻'} fresh
      </button>
    </div>
  )
}
