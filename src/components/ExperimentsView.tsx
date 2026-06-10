import type { ExperimentRun } from '../types'

function fmtMetric(run: ExperimentRun, v: number) {
  return run.task === 'classification' ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)
}
function shortTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

/** Ids of the best run (highest primary metric) within each table+target group. */
function bestRunIds(runs: ExperimentRun[]): Set<string> {
  const best = new Map<string, ExperimentRun>()
  for (const r of runs) {
    const key = `${r.table}|${r.target}`
    const cur = best.get(key)
    if (!cur || r.primaryModel > cur.primaryModel) best.set(key, r)
  }
  return new Set([...best.values()].map((r) => r.id))
}

export function ExperimentsView({ runs }: { runs: ExperimentRun[] }) {
  if (!runs.length) {
    return (
      <div className="empty">
        No experiments yet. Every time a <b>Model</b> cell trains, the run is logged here so you can
        compare what changed and what won.
      </div>
    )
  }
  const winners = bestRunIds(runs)
  const ordered = [...runs].reverse() // newest first

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="profile-table">
        <thead>
          <tr>
            <th>when</th>
            <th>target</th>
            <th>algo</th>
            <th>feats</th>
            <th>metric</th>
            <th>vs base</th>
            <th>gate</th>
            <th>leak</th>
            <th>robustness</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => {
            const isBest = winners.has(r.id)
            const lift = r.primaryModel - r.primaryBaseline
            const fragile = r.worstStressDelta != null && r.worstStressDelta < -0.05 * Math.max(0.0001, Math.abs(r.primaryModel))
            return (
              <tr key={r.id} style={isBest ? { background: 'rgba(45,212,191,0.07)' } : undefined}>
                <td style={{ color: 'var(--text-faint)' }} title={r.ts}>
                  {isBest && <span title="best for this target">★ </span>}
                  {shortTime(r.ts)}
                </td>
                <td style={{ fontFamily: 'var(--mono)' }} title={`${r.table}.${r.target}`}>
                  {r.target}
                </td>
                <td style={{ color: 'var(--text-dim)' }}>{r.algo}</td>
                <td>{r.nFeatures}</td>
                <td style={{ fontWeight: 700 }} title={r.primaryName}>
                  {fmtMetric(r, r.primaryModel)}
                </td>
                <td style={{ color: 'var(--text-faint)' }}>
                  {fmtMetric(r, r.primaryBaseline)}{' '}
                  <span style={{ color: lift > 0 ? 'var(--ok)' : 'var(--err)' }}>
                    ({lift >= 0 ? '+' : ''}
                    {fmtMetric(r, lift)})
                  </span>
                </td>
                <td style={{ color: r.beatsBaseline ? 'var(--ok)' : 'var(--err)', fontWeight: 700 }}>
                  {r.beatsBaseline ? '✓' : '✕'}
                </td>
                <td style={{ color: r.leakageCount ? 'var(--warn)' : 'var(--text-faint)' }}>
                  {r.leakageCount || '—'}
                </td>
                <td
                  style={{ color: fragile ? 'var(--err)' : r.worstStressDelta == null ? 'var(--text-faint)' : 'var(--ok)' }}
                  title="worst metric drop across stress perturbations"
                >
                  {r.worstStressDelta == null ? '—' : `${r.worstStressDelta >= 0 ? '+' : ''}${fmtMetric(r, r.worstStressDelta)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
