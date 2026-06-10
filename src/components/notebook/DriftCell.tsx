import { useStore } from '../../state/store'
import { runCell } from '../../engine/runtime'
import type { Cell, DriftSpec } from '../../types'
import type { DriftResult } from '../../engine/drift'
import { DriftResultView } from '../DriftResultView'

export function DriftCell({ cell }: { cell: Cell }) {
  const tables = useStore((s) => s.tables)
  const updateCell = useStore((s) => s.updateCell)
  const spec: DriftSpec = cell.drift || {}
  const tableNames = Object.keys(tables).sort()
  const result = cell.output?.drift as DriftResult | undefined

  function update(patch: Partial<DriftSpec>) {
    updateCell(cell.id, { drift: { ...spec, ...patch } })
  }

  return (
    <div>
      <div className="chart-builder">
        <label>
          Baseline
          <select value={spec.baseline || ''} onChange={(e) => update({ baseline: e.target.value || undefined })}>
            <option value="">—</option>
            {tableNames.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: 'var(--text-faint)', alignSelf: 'flex-end', paddingBottom: 4 }}>→</span>
        <label>
          Current
          <select value={spec.current || ''} onChange={(e) => update({ current: e.target.value || undefined })}>
            <option value="">—</option>
            {tableNames.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn sm primary"
          disabled={!spec.baseline || !spec.current || cell.status === 'running'}
          onClick={() => runCell(cell.id, false)}
        >
          {cell.status === 'running' ? <span className="spinner" /> : '▷'} Compare
        </button>
      </div>

      {cell.output?.error && <div className="out-error">{cell.output.error}</div>}

      {result ? (
        <DriftResultView result={result} />
      ) : (
        !cell.output?.error && (
          <div className="empty">
            Compare a <b>current</b> dataset against a <b>baseline</b> to catch silent shift. Each
            shared column gets a <b>PSI</b> score (population stability index), null-rate change, mean
            shift (numeric), and new/missing categories (categorical). PSI &gt; 0.25 = significant
            drift, which flags the ship-ready banner.
          </div>
        )
      )}
    </div>
  )
}
