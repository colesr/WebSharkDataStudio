import type { TablePreview } from '../../types'

function fmt(v: unknown): { text: string; isNum: boolean; isNull: boolean } {
  if (v === null || v === undefined) return { text: 'null', isNum: false, isNull: true }
  if (typeof v === 'number') {
    const text = Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 6 })
    return { text, isNum: true, isNull: false }
  }
  if (typeof v === 'boolean') return { text: String(v), isNum: false, isNull: false }
  return { text: String(v), isNum: false, isNull: false }
}

export function OutputTable({ table }: { table: TablePreview }) {
  return (
    <div>
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ color: 'var(--text-faint)' }}>#</th>
            {table.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              <td style={{ color: 'var(--text-faint)' }}>{i + 1}</td>
              {table.columns.map((c) => {
                const f = fmt(row[c])
                return (
                  <td key={c} className={f.isNum ? 'num' : f.isNull ? 'null-cell' : ''} title={f.text}>
                    {f.text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="out-meta">
        {table.totalRows.toLocaleString()} rows × {table.columns.length} cols
        {table.truncated && ` · showing first ${table.rows.length}`}
      </div>
    </div>
  )
}
