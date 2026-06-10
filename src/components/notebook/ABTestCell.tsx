import { useStore } from '../../state/store'
import { runCell } from '../../engine/runtime'
import type { Cell, ABSpec } from '../../types'
import type { ABResult } from '../../engine/abtest'
import { ABResultView } from '../ABResultView'

export function ABTestCell({ cell }: { cell: Cell }) {
  const tables = useStore((s) => s.tables)
  const dictionary = useStore((s) => s.dictionary)
  const updateCell = useStore((s) => s.updateCell)

  const spec: ABSpec = cell.abtest || { table: '', metricType: 'mean' }
  const tableNames = Object.keys(tables).sort()
  const columns = spec.table ? (dictionary[spec.table] || []).map((c) => c.name) : []
  const result = cell.output?.abtest as ABResult | undefined

  function update(patch: Partial<ABSpec>) {
    updateCell(cell.id, { abtest: { ...spec, ...patch } })
  }

  return (
    <div>
      <div className="chart-builder">
        <label>
          Table
          <select
            value={spec.table}
            onChange={(e) => update({ table: e.target.value, variantCol: undefined, metricCol: undefined, control: undefined })}
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
          Variant
          <select value={spec.variantCol || ''} onChange={(e) => update({ variantCol: e.target.value || undefined, control: undefined })}>
            <option value="">—</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Metric
          <select value={spec.metricCol || ''} onChange={(e) => update({ metricCol: e.target.value || undefined })}>
            <option value="">—</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={spec.metricType} onChange={(e) => update({ metricType: e.target.value as ABSpec['metricType'] })}>
            <option value="mean">mean (continuous)</option>
            <option value="proportion">proportion (0/1)</option>
          </select>
        </label>
        <label>
          Control
          <select value={spec.control || ''} onChange={(e) => update({ control: e.target.value || undefined })}>
            <option value="">auto (first)</option>
            {result?.variants.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          α
          <select value={String(spec.alpha ?? 0.05)} onChange={(e) => update({ alpha: Number(e.target.value) })}>
            <option value="0.05">0.05</option>
            <option value="0.01">0.01</option>
            <option value="0.1">0.10</option>
          </select>
        </label>
        <button
          className="btn sm primary"
          disabled={!spec.table || !spec.variantCol || !spec.metricCol || cell.status === 'running'}
          onClick={() => runCell(cell.id, false)}
        >
          {cell.status === 'running' ? <span className="spinner" /> : '▷'} Analyze
        </button>
      </div>

      {cell.output?.error && <div className="out-error">{cell.output.error}</div>}

      {result ? (
        <ABResultView result={result} />
      ) : (
        !cell.output?.error && (
          <div className="empty">
            Compare a metric across variants. Pick a <b>variant</b> column (the group label) and a{' '}
            <b>metric</b> column. Use <b>proportion</b> for 0/1 outcomes (e.g. churned, converted) or{' '}
            <b>mean</b> for continuous ones (e.g. spend). You get lift, confidence intervals,
            p-values, and a sample-ratio-mismatch check.
          </div>
        )
      )}
    </div>
  )
}
