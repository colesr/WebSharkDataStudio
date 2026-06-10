import type { ABResult } from '../engine/abtest'

function pval(p: number) {
  if (p < 0.0001) return '<0.0001'
  return p.toFixed(4)
}

export function ABResultView({ result }: { result: ABResult }) {
  const isProp = result.metricType === 'proportion'
  const fmt = (v: number) => (isProp ? `${(v * 100).toFixed(2)}%` : v.toFixed(3))
  // For lift we always show a percent (relative change).
  const fmtLift = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`)
  const total = result.variants.reduce((s, v) => s + v.n, 0)

  return (
    <div style={{ padding: '4px 0' }}>
      {/* SRM / data-integrity banner */}
      {result.srm.mismatch ? (
        <div
          style={{
            margin: '8px 12px',
            padding: '8px 10px',
            border: '1px solid var(--err)',
            borderRadius: 6,
            background: 'rgba(248,81,73,0.08)',
            color: 'var(--err)',
            fontSize: 12,
          }}
        >
          ✕ <b>Sample ratio mismatch</b> — observed group sizes deviate from an even split (χ²=
          {result.srm.chi2.toFixed(1)}, p={pval(result.srm.pValue)}). Randomization or logging may be
          broken; treat results with suspicion.
        </div>
      ) : (
        <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--ok)' }}>
          ✓ Sample ratios balanced (SRM p={pval(result.srm.pValue)})
        </div>
      )}

      {result.warnings.map((w, i) => (
        <div key={i} style={{ padding: '2px 12px', fontSize: 11, color: 'var(--warn)' }}>
          ▲ {w}
        </div>
      ))}

      <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-faint)' }}>
        {result.metricType} metric · control = <b style={{ color: 'var(--text-dim)' }}>{result.control}</b> ·
        α={result.alpha} · n={total.toLocaleString()}
      </div>

      {/* per-variant summary */}
      <div style={{ overflowX: 'auto' }}>
        <table className="profile-table">
          <thead>
            <tr>
              <th>variant</th>
              <th>n</th>
              <th>share</th>
              <th>{isProp ? 'rate' : 'mean'}</th>
              {!isProp && <th>std</th>}
            </tr>
          </thead>
          <tbody>
            {result.variants.map((v) => (
              <tr key={v.name}>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                  {v.name} {v.isControl && <span className="badge">control</span>}
                </td>
                <td>{v.n.toLocaleString()}</td>
                <td style={{ color: 'var(--text-faint)' }}>{((v.n / total) * 100).toFixed(1)}%</td>
                <td style={{ fontWeight: 600 }}>{fmt(v.mean)}</td>
                {!isProp && <td style={{ color: 'var(--text-dim)' }}>{v.std.toFixed(3)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* comparisons vs control */}
      <div style={{ padding: '8px 12px 4px', fontSize: 11, color: 'var(--text-dim)' }}>
        vs. {result.control}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="profile-table">
          <thead>
            <tr>
              <th>variant</th>
              <th>lift</th>
              <th>abs diff</th>
              <th>95% CI</th>
              <th>p-value</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {result.comparisons.map((c) => (
              <tr key={c.variant}>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{c.variant}</td>
                <td style={{ color: c.lift != null && c.lift >= 0 ? 'var(--ok)' : 'var(--err)' }}>
                  {fmtLift(c.lift)}
                </td>
                <td>{fmt(c.absDiff)}</td>
                <td style={{ color: 'var(--text-faint)' }}>
                  [{fmt(c.ci[0])}, {fmt(c.ci[1])}]
                </td>
                <td>{pval(c.pValue)}</td>
                <td>
                  <span
                    className="badge"
                    style={{
                      color: c.significant ? 'var(--ok)' : 'var(--text-dim)',
                      borderColor: c.significant ? 'var(--ok)' : 'var(--border)',
                    }}
                  >
                    {c.significant ? `significant (p<${result.alpha})` : 'not significant'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
