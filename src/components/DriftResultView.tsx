import type { DriftResult, DriftStatus } from '../engine/drift'

const STATUS_COLOR: Record<DriftStatus, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  drift: 'var(--err)',
}
const STATUS_LABEL: Record<DriftStatus, string> = {
  ok: 'stable',
  warn: 'moderate drift',
  drift: 'significant drift',
}

export function DriftResultView({ result }: { result: DriftResult }) {
  const maxPsi = Math.max(0.5, ...result.columns.map((c) => c.psi))
  return (
    <div style={{ padding: '4px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          flexWrap: 'wrap',
        }}
      >
        <span
          className="badge"
          style={{ color: STATUS_COLOR[result.overall], borderColor: STATUS_COLOR[result.overall], fontSize: 12, padding: '3px 10px' }}
        >
          {result.overall === 'ok' ? '✓' : result.overall === 'warn' ? '▲' : '✕'} {STATUS_LABEL[result.overall]}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          <b style={{ color: 'var(--text-dim)' }}>{result.baseline}</b> ({result.baseRows.toLocaleString()}) →{' '}
          <b style={{ color: 'var(--text-dim)' }}>{result.current}</b> ({result.curRows.toLocaleString()}) ·{' '}
          {result.columns.length} cols · {result.driftedCount} drifted
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="profile-table">
          <thead>
            <tr>
              <th></th>
              <th>column</th>
              <th>PSI</th>
              <th></th>
              <th>nulls Δ</th>
              <th>change</th>
            </tr>
          </thead>
          <tbody>
            {result.columns.map((c) => (
              <tr key={c.name}>
                <td>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: STATUS_COLOR[c.status],
                    }}
                  />
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                  {c.name}
                  <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · {c.kind}</span>
                </td>
                <td style={{ fontWeight: 600, color: STATUS_COLOR[c.status] }}>{c.psi.toFixed(3)}</td>
                <td style={{ width: 90 }}>
                  <div className="nullbar" style={{ minWidth: 70 }}>
                    <div style={{ width: `${Math.min(100, (c.psi / maxPsi) * 100)}%`, background: STATUS_COLOR[c.status] }} />
                  </div>
                </td>
                <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {c.baseNullPct.toFixed(0)}% → {c.curNullPct.toFixed(0)}%
                </td>
                <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {c.kind === 'numeric' && c.meanShiftPct != null && (
                    <span title="relative change in mean">
                      mean {c.meanShiftPct >= 0 ? '+' : ''}
                      {(c.meanShiftPct * 100).toFixed(1)}%
                      {c.ks != null && <span style={{ color: 'var(--text-faint)' }}> · KS {c.ks.toFixed(2)}</span>}
                    </span>
                  )}
                  {c.kind === 'categorical' && (c.newCategories?.length || c.missingCategories?.length) ? (
                    <span>
                      {c.newCategories?.length ? (
                        <span style={{ color: 'var(--warn)' }}>+new: {c.newCategories.join(', ')}</span>
                      ) : null}
                      {c.missingCategories?.length ? (
                        <span style={{ color: 'var(--err)', marginLeft: 6 }}>
                          missing: {c.missingCategories.join(', ')}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  {c.note && c.note.startsWith('skipped') && (
                    <span style={{ color: 'var(--text-faint)' }}>{c.note}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '6px 12px', fontSize: 10, color: 'var(--text-faint)' }}>
        PSI &lt; 0.10 stable · 0.10–0.25 moderate · &gt; 0.25 significant drift
      </div>
    </div>
  )
}
