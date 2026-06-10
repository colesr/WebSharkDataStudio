import { useState } from 'react'
import { useStore } from '../../state/store'
import { runCell } from '../../engine/runtime'
import type { Cell, ModelSpec } from '../../types'
import type { ModelResult } from '../../engine/model'
import { ModelResultView } from '../ModelResultView'

const ALGOS: { value: ModelSpec['algo']; label: string }[] = [
  { value: 'forest', label: 'Random Forest' },
  { value: 'linear', label: 'Linear / Logistic' },
  { value: 'tree', label: 'Decision Tree' },
]

export function ModelCell({ cell }: { cell: Cell }) {
  const tables = useStore((s) => s.tables)
  const dictionary = useStore((s) => s.dictionary)
  const updateCell = useStore((s) => s.updateCell)
  const [showFeatures, setShowFeatures] = useState(false)

  const spec: ModelSpec = cell.model || { table: '', algo: 'forest' }
  const tableNames = Object.keys(tables).sort()
  const columns = spec.table ? (dictionary[spec.table] || []).map((c) => c.name) : []
  const candidateFeatures = columns.filter((c) => c !== spec.target)
  const selectedFeatures = spec.features && spec.features.length ? spec.features : candidateFeatures
  const result = cell.output?.model as ModelResult | undefined

  function update(patch: Partial<ModelSpec>) {
    updateCell(cell.id, { model: { ...spec, ...patch } })
  }
  function toggleFeature(col: string) {
    const set = new Set(selectedFeatures)
    if (set.has(col)) set.delete(col)
    else set.add(col)
    update({ features: candidateFeatures.filter((c) => set.has(c)) })
  }

  return (
    <div>
      <div className="chart-builder">
        <label>
          Table
          <select
            value={spec.table}
            onChange={(e) => update({ table: e.target.value, target: undefined, features: undefined })}
          >
            <option value="">—</option>
            {tableNames.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target
          <select value={spec.target || ''} onChange={(e) => update({ target: e.target.value || undefined, features: undefined })}>
            <option value="">—</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Algorithm
          <select value={spec.algo} onChange={(e) => update({ algo: e.target.value as ModelSpec['algo'] })}>
            {ALGOS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Features
          <button className="btn sm" type="button" onClick={() => setShowFeatures((v) => !v)} disabled={!spec.target}>
            {selectedFeatures.length}/{candidateFeatures.length} {showFeatures ? '▴' : '▾'}
          </button>
        </label>
        <button
          className="btn sm primary"
          disabled={!spec.table || !spec.target || cell.status === 'running'}
          onClick={() => runCell(cell.id, false)}
        >
          {cell.status === 'running' ? <span className="spinner" /> : '▷'} Train & evaluate
        </button>
      </div>

      {showFeatures && spec.target && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 12px 10px' }}>
          {candidateFeatures.map((c) => (
            <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={selectedFeatures.includes(c)} onChange={() => toggleFeature(c)} />
              {c}
            </label>
          ))}
        </div>
      )}

      {cell.output?.error && <div className="out-error">{cell.output.error}</div>}

      {result ? (
        <ModelResultView result={result} />
      ) : (
        !cell.output?.error && (
          <div className="empty">
            Pick a table + target, then train. The target type is auto-detected (classification vs
            regression). Every model is graded against a dumb <b>baseline</b>, screened for{' '}
            <b>leakage</b>, and <b>stress-tested</b> by perturbing the test set. First run loads
            scikit-learn (~20s).
          </div>
        )
      )}
    </div>
  )
}
