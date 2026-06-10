import { useStore } from '../../state/store'
import { ExperimentsView } from '../ExperimentsView'

export function ExperimentsCell() {
  const experiments = useStore((s) => s.experiments)
  const clearExperiments = useStore((s) => s.clearExperiments)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {experiments.length} run{experiments.length === 1 ? '' : 's'} logged · ★ = best for that target
        </span>
        <span style={{ flex: 1 }} />
        {experiments.length > 0 && (
          <button
            className="btn sm ghost"
            onClick={() => {
              if (confirm('Clear all logged experiments?')) clearExperiments()
            }}
          >
            Clear
          </button>
        )}
      </div>
      <ExperimentsView runs={experiments} />
    </div>
  )
}
