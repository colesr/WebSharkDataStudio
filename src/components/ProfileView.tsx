import { Fragment } from 'react'
import type { TableProfile, ColumnProfile } from '../engine/profile'

function MiniHist({ col }: { col: ColumnProfile }) {
  if (col.histogram && col.histogram.length) {
    const max = Math.max(...col.histogram.map((h) => h.count), 1)
    return (
      <div className="mini-hist" title={col.histogram.map((h) => `${h.bin}: ${h.count}`).join('\n')}>
        {col.histogram.map((h, i) => (
          <div key={i} style={{ height: `${(h.count / max) * 100}%` }} />
        ))}
      </div>
    )
  }
  if (col.topValues && col.topValues.length) {
    const max = Math.max(...col.topValues.map((v) => v.count), 1)
    return (
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
        {col.topValues.slice(0, 3).map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.value || '∅'}
            </span>
            <div className="nullbar" style={{ width: 40 }}>
              <div style={{ width: `${(v.count / max) * 100}%`, background: 'var(--accent-deep)' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return null
}

function corrColor(r: number): string {
  // diverging teal (pos) / red (neg)
  const a = Math.min(1, Math.abs(r))
  if (r >= 0) return `rgba(45, 212, 191, ${0.15 + a * 0.85})`
  return `rgba(248, 81, 73, ${0.15 + a * 0.85})`
}

function CorrMatrix({ profile }: { profile: TableProfile }) {
  if (!profile.correlations || profile.numericColumns.length < 2) return null
  const cols = profile.numericColumns.slice(0, 8)
  const map = new Map(profile.correlations.map((c) => [`${c.a}|${c.b}`, c.r]))
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
        Correlation (numeric columns)
      </div>
      <div
        className="corr-grid"
        style={{ gridTemplateColumns: `70px repeat(${cols.length}, 1fr)` }}
      >
        <div />
        {cols.map((c) => (
          <div key={c} style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'center', overflow: 'hidden' }}>
            {c.slice(0, 6)}
          </div>
        ))}
        {cols.map((row) => (
          <Fragment key={row}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'right', paddingRight: 4 }}>
              {row.slice(0, 8)}
            </div>
            {cols.map((c) => {
              const r = map.get(`${row}|${c}`) ?? 0
              return (
                <div
                  key={`${row}-${c}`}
                  className="corr-cell"
                  style={{ background: corrColor(r) }}
                  title={`${row} vs ${c}: ${r.toFixed(2)}`}
                >
                  {Math.abs(r) > 0.3 ? r.toFixed(1) : ''}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export function ProfileView({ profile }: { profile: TableProfile }) {
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ padding: '6px 12px', color: 'var(--text-dim)', fontSize: 12 }}>
        <strong style={{ color: 'var(--text)' }}>{profile.table}</strong> ·{' '}
        {profile.rowCount.toLocaleString()} rows · {profile.columns.length} columns
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="profile-table">
          <thead>
            <tr>
              <th>column</th>
              <th>type</th>
              <th>nulls</th>
              <th>distinct</th>
              <th>stats</th>
              <th>distribution</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((c) => (
              <tr key={c.name}>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{c.name}</td>
                <td style={{ color: 'var(--text-faint)' }}>{c.kind}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div className="nullbar">
                      <div style={{ width: `${c.nullPct}%` }} />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                      {c.nullPct.toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td>{c.distinct.toLocaleString()}</td>
                <td style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  {c.kind === 'numeric' && c.mean != null ? (
                    <>
                      μ {c.mean.toPrecision(3)} · σ {c.std?.toPrecision(3)}
                      <br />
                      [{c.min?.toPrecision(3)}, {c.max?.toPrecision(3)}]
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ width: 130 }}>
                  <MiniHist col={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CorrMatrix profile={profile} />
    </div>
  )
}
