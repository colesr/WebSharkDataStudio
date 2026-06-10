import { useStore } from '../../state/store'
import { runCell } from '../../engine/runtime'
import { cellDeps, pythonWrites } from '../../engine/dag'
import { STRESS_ATTACKS, type StressResult } from '../../engine/stress'
import type { Cell } from '../../types'

const STATUS_COLOR: Record<StressResult['status'], string> = {
  ok: 'var(--ok)',
  warning: 'var(--warn)',
  error: 'var(--err)',
}
const STATUS_ICON: Record<StressResult['status'], string> = {
  ok: '✓',
  warning: '▲',
  error: '✕',
}

/** A cell is a valid stress target if it reads a table and produces one. */
function isTransform(cell: Cell): boolean {
  if (cell.type !== 'sql' && cell.type !== 'python') return false
  const deps = cellDeps(cell)
  const out = cell.type === 'python' ? pythonWrites(cell)[0] : deps.produces
  return deps.reads.length > 0 && !!out
}

export function StressCell({ cell }: { cell: Cell }) {
  const cells = useStore((s) => s.cells)
  const updateCell = useStore((s) => s.updateCell)
  const results = cell.output?.stress as StressResult[] | undefined

  const candidates = cells.filter(isTransform)
  const targetId = cell.stressTarget?.cellId
  const target = cells.find((c) => c.id === targetId)

  function label(c: Cell): string {
    const deps = cellDeps(c)
    const out = c.type === 'python' ? pythonWrites(c)[0] : deps.produces
    return `${c.type.toUpperCase()} · ${deps.reads[0]} → ${out}`
  }

  const passed = results?.filter((r) => r.status === 'ok').length ?? 0
  const warned = results?.filter((r) => r.status === 'warning').length ?? 0
  const failed = results?.filter((r) => r.status === 'error').length ?? 0

  return (
    <div>
      <div className="chart-builder">
        <label style={{ flex: 1 }}>
          Transform to stress-test
          <select
            value={targetId || ''}
            onChange={(e) => updateCell(cell.id, { stressTarget: { cellId: e.target.value || undefined } })}
          >
            <option value="">— pick a SQL/Python transform —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn sm primary"
          disabled={!targetId || cell.status === 'running'}
          onClick={() => runCell(cell.id, false)}
        >
          {cell.status === 'running' ? <span className="spinner" /> : '⚡'} Run {STRESS_ATTACKS.length} attacks
        </button>
      </div>

      {!target && (
        <div className="empty">
          Pick a transform cell (one that reads a table and produces an output). The harness rebuilds
          its input with {STRESS_ATTACKS.length} adversarial mutations — empty, single-row, duplicates,
          ×25 volume, null bombs, numeric extremes, blank/whitespace/mixed-case/unicode text — and
          reports what breaks.
        </div>
      )}

      {cell.output?.error && <div className="out-error">{cell.output.error}</div>}

      {results && (
        <>
          <div style={{ display: 'flex', gap: 14, padding: '6px 12px', fontSize: 12 }}>
            <span style={{ color: 'var(--ok)' }}>✓ {passed} passed</span>
            {warned > 0 && <span style={{ color: 'var(--warn)' }}>▲ {warned} warnings</span>}
            {failed > 0 && <span style={{ color: 'var(--err)' }}>✕ {failed} broke</span>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="profile-table">
              <thead>
                <tr>
                  <th></th>
                  <th>attack</th>
                  <th>in rows</th>
                  <th>out rows</th>
                  <th>time</th>
                  <th>finding</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const desc = STRESS_ATTACKS.find((a) => a.key === r.attack)?.description
                  return (
                    <tr key={r.attack}>
                      <td style={{ color: STATUS_COLOR[r.status], fontWeight: 700 }}>
                        {STATUS_ICON[r.status]}
                      </td>
                      <td style={{ fontWeight: 600 }} title={desc}>
                        {r.label}
                      </td>
                      <td>{r.inputRows.toLocaleString()}</td>
                      <td>{r.outputRows != null ? r.outputRows.toLocaleString() : '—'}</td>
                      <td style={{ color: 'var(--text-faint)' }}>{Math.round(r.durationMs)}ms</td>
                      <td style={{ color: r.status === 'ok' ? 'var(--text-faint)' : STATUS_COLOR[r.status] }}>
                        {r.message || (r.status === 'ok' ? 'ok' : '')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
