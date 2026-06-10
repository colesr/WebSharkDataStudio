import type { ModelResult } from '../engine/model'

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}
function num(v: number) {
  return Math.abs(v) >= 1000 || Number.isInteger(v) ? v.toLocaleString() : v.toFixed(3)
}

function ConfusionMatrix({ result }: { result: ModelResult }) {
  const cm = result.confusion
  if (!cm) return null
  const max = Math.max(1, ...cm.matrix.flat())
  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
        Confusion matrix (rows = actual, cols = predicted)
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="profile-table" style={{ width: 'auto' }}>
          <thead>
            <tr>
              <th></th>
              {cm.labels.map((l) => (
                <th key={l} style={{ textAlign: 'center' }}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cm.matrix.map((row, i) => (
              <tr key={i}>
                <th>{cm.labels[i]}</th>
                {row.map((v, j) => (
                  <td
                    key={j}
                    style={{
                      textAlign: 'center',
                      background:
                        i === j
                          ? `rgba(45,212,191,${0.12 + (v / max) * 0.6})`
                          : v > 0
                            ? `rgba(248,81,73,${0.12 + (v / max) * 0.55})`
                            : 'transparent',
                      fontWeight: i === j ? 700 : 400,
                    }}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ModelResultView({ result }: { result: ModelResult }) {
  if (result.error) return <div className="out-error">{result.error}</div>
  const pm = result.primaryMetric
  const isClass = result.task === 'classification'
  const fmt = (v: number) => (isClass ? pct(v) : num(v))
  const lift = pm.model - pm.baseline

  return (
    <div style={{ padding: '4px 0' }}>
      {/* headline: primary metric vs baseline + ship gate */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{pm.name}</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{fmt(pm.model)}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          baseline {fmt(pm.baseline)}
          <br />
          {isClass ? 'most-frequent' : 'mean'} predictor
        </div>
        <div
          className="badge"
          style={{
            color: result.beatsBaseline ? 'var(--ok)' : 'var(--err)',
            borderColor: result.beatsBaseline ? 'var(--ok)' : 'var(--err)',
            fontSize: 12,
            padding: '3px 10px',
          }}
          title="A model that can't beat a dumb baseline isn't learning anything."
        >
          {result.beatsBaseline ? `✓ beats baseline (+${fmt(Math.abs(lift))})` : '✕ does not beat baseline'}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
          {result.task} · {result.algo}
          <br />
          {result.nTrain}/{result.nTest} train/test · {result.nFeatures} feats
        </div>
      </div>

      {/* metrics row */}
      <div style={{ display: 'flex', gap: 18, padding: '4px 12px', flexWrap: 'wrap', fontSize: 12 }}>
        {Object.entries(result.metrics).map(([k, v]) => (
          <span key={k} style={{ color: 'var(--text-dim)' }}>
            {k} <b style={{ color: 'var(--text)' }}>{isClass && k !== 'rmse' && k !== 'mae' ? pct(v) : num(v)}</b>
          </span>
        ))}
      </div>

      {/* leakage warnings (model contract) */}
      {result.leakage.length > 0 && (
        <div style={{ margin: '8px 12px', padding: '8px 10px', border: '1px solid var(--warn)', borderRadius: 6, background: 'rgba(210,153,34,0.07)' }}>
          <div style={{ color: 'var(--warn)', fontWeight: 600, fontSize: 12 }}>
            ▲ Possible leakage / dead features
          </div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11.5, color: 'var(--text-dim)' }}>
            {result.leakage.map((l, i) => (
              <li key={i}>
                <code>{l.feature}</code> — {l.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isClass && <ConfusionMatrix result={result} />}

      {/* importances */}
      {result.importances && result.importances.length > 0 && (
        <div style={{ padding: '6px 12px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Top features</div>
          {(() => {
            const max = Math.max(...result.importances!.map((i) => i.value), 1e-9)
            return result.importances!.map((imp) => (
              <div key={imp.feature} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ width: 130, fontSize: 11, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {imp.feature}
                </span>
                <div className="nullbar" style={{ flex: 1 }}>
                  <div style={{ width: `${(imp.value / max) * 100}%`, background: 'var(--accent-deep)' }} />
                </div>
              </div>
            ))
          })()}
        </div>
      )}

      {/* model stress-test */}
      {result.stress.length > 0 && (
        <div style={{ padding: '8px 12px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
            Robustness — {pm.name} when the test set is perturbed
          </div>
          <table className="profile-table">
            <tbody>
              {result.stress.map((s, i) => {
                const delta = s.metric == null ? null : s.metric - s.clean
                const bad = delta != null && delta < -0.05 * Math.max(0.0001, Math.abs(s.clean))
                return (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td style={{ fontWeight: 600 }}>{s.metric == null ? '—' : fmt(s.metric)}</td>
                    <td style={{ color: bad ? 'var(--err)' : delta != null && delta < 0 ? 'var(--warn)' : 'var(--ok)' }}>
                      {delta == null ? '' : `${delta >= 0 ? '+' : ''}${fmt(delta)}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
