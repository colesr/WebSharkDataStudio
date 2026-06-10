import { useStore } from '../../state/store'
import { runCell } from '../../engine/runtime'
import type { Cell } from '../../types'
import type { TableProfile } from '../../engine/profile'
import { ProfileView } from '../ProfileView'

export function ProfileCell({ cell }: { cell: Cell }) {
  const tables = useStore((s) => s.tables)
  const updateCell = useStore((s) => s.updateCell)
  const tableNames = Object.keys(tables).sort()
  const profile = cell.output?.profile as TableProfile | undefined

  return (
    <div>
      <div className="chart-builder">
        <label>
          Profile table
          <select
            value={cell.profileTarget || ''}
            onChange={(e) => {
              updateCell(cell.id, { profileTarget: e.target.value || undefined })
              setTimeout(() => runCell(cell.id, false), 0)
            }}
          >
            <option value="">—</option>
            {tableNames.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {cell.status === 'running' && <span className="spinner" />}
      </div>
      {cell.output?.error ? (
        <div className="out-error">{cell.output.error}</div>
      ) : profile ? (
        <ProfileView profile={profile} />
      ) : (
        <div className="empty">Select a table to profile it (stats, distributions, correlations).</div>
      )}
    </div>
  )
}
