import { useStore } from '../../state/store'
import type { SemanticType } from '../../types'

const SEM_TYPES: SemanticType[] = [
  'id',
  'email',
  'url',
  'category',
  'currency',
  'datetime',
  'boolean',
  'numeric',
  'text',
  'unknown',
]

export function DataDictionary({ table }: { table: string }) {
  const cols = useStore((s) => s.dictionary[table]) || []
  const updateColumnMeta = useStore((s) => s.updateColumnMeta)

  if (!cols.length) {
    return <div className="empty">No column metadata yet.</div>
  }

  return (
    <div style={{ overflowY: 'auto' }}>
      <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-faint)' }}>
        Auto-inferred semantic types & stats. Edit descriptions — they’re saved with the project.
      </div>
      {cols.map((col) => (
        <div className="dict-col" key={col.name}>
          <div className="col-head">
            <span className="col-name">{col.name}</span>
            <select
              className={`sem-pill ${col.semanticType}`}
              value={col.semanticType}
              onChange={(e) => updateColumnMeta(table, col.name, { semanticType: e.target.value as SemanticType })}
              title="Semantic type (editable)"
            >
              {SEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{col.physicalType}</span>
          </div>
          <div className="col-stats">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 110 }}>
              nulls
              <div className="nullbar">
                <div style={{ width: `${col.nullPct}%` }} />
              </div>
              {col.nullPct.toFixed(0)}%
            </span>
            {col.distinctCount != null && <span>{col.distinctCount.toLocaleString()} distinct</span>}
          </div>
          {col.sampleValues.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
              e.g. {col.sampleValues.slice(0, 4).join(', ')}
            </div>
          )}
          <textarea
            className="dict-desc"
            rows={1}
            placeholder="Describe what this column means…"
            value={col.description}
            onChange={(e) => updateColumnMeta(table, col.name, { description: e.target.value })}
          />
        </div>
      ))}
    </div>
  )
}
