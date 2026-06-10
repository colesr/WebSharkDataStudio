import { useStore } from '../../state/store'
import { runCell } from '../../engine/runtime'
import type { Cell, ChartSpec } from '../../types'
import { VegaView } from './VegaView'

const MARKS: ChartSpec['mark'][] = ['bar', 'line', 'point', 'area', 'tick', 'arc']
const AGGS: NonNullable<ChartSpec['aggregate']>[] = ['none', 'count', 'sum', 'mean', 'median', 'min', 'max']

export function ChartCell({ cell }: { cell: Cell }) {
  const tables = useStore((s) => s.tables)
  const dictionary = useStore((s) => s.dictionary)
  const updateCell = useStore((s) => s.updateCell)

  const chart: ChartSpec = cell.chart || { table: '', mark: 'bar', aggregate: 'none' }
  const tableNames = Object.keys(tables).sort()
  const cols = chart.table ? (dictionary[chart.table] || []).map((c) => c.name) : []

  function update(patch: Partial<ChartSpec>) {
    const next = { ...chart, ...patch }
    updateCell(cell.id, { chart: next })
    // Re-render automatically.
    setTimeout(() => runCell(cell.id, false), 0)
  }

  return (
    <div>
      <div className="chart-builder">
        <label>
          Table
          <select value={chart.table} onChange={(e) => update({ table: e.target.value })}>
            <option value="">—</option>
            {tableNames.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mark
          <select value={chart.mark} onChange={(e) => update({ mark: e.target.value as ChartSpec['mark'] })}>
            {MARKS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          X
          <select value={chart.x || ''} onChange={(e) => update({ x: e.target.value || undefined })}>
            <option value="">—</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Y
          <select value={chart.y || ''} onChange={(e) => update({ y: e.target.value || undefined })}>
            <option value="">—</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Aggregate
          <select
            value={chart.aggregate || 'none'}
            onChange={(e) => update({ aggregate: e.target.value as ChartSpec['aggregate'] })}
          >
            {AGGS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Color
          <select value={chart.color || ''} onChange={(e) => update({ color: e.target.value || undefined })}>
            <option value="">—</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {cell.output?.vegaSpec ? (
        <VegaView spec={cell.output.vegaSpec} />
      ) : cell.output?.error ? (
        <div className="out-error">{cell.output.error}</div>
      ) : (
        <div className="empty">Pick a table and encodings to draw a chart.</div>
      )}
    </div>
  )
}
