import { useStore } from '../../state/store'
import { DataDictionary } from './DataDictionary'
import { ProfilePanel } from './ProfilePanel'

export function Inspector() {
  const selectedTable = useStore((s) => s.selectedTable)
  const tab = useStore((s) => s.inspectorTab)
  const setTab = useStore((s) => s.setInspectorTab)

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Inspector</span>
        {selectedTable && <span style={{ color: 'var(--accent)' }}>{selectedTable}</span>}
      </div>
      {!selectedTable ? (
        <div className="empty">
          Select a table in the left panel to see its <strong>data dictionary</strong> (auto-inferred
          column meanings you can edit) and a one-click <strong>profile</strong>.
        </div>
      ) : (
        <>
          <div className="tabs">
            <div className={`tab ${tab === 'dictionary' ? 'active' : ''}`} onClick={() => setTab('dictionary')}>
              Dictionary
            </div>
            <div className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
              Profile
            </div>
          </div>
          {tab === 'dictionary' ? (
            <DataDictionary table={selectedTable} />
          ) : (
            <ProfilePanel table={selectedTable} />
          )}
        </>
      )}
    </div>
  )
}
