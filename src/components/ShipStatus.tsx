import { useStore } from '../state/store'

// A single at-a-glance contract health indicator for the toolbar:
//   grey  = no contracts defined
//   amber = contracts defined but not yet checked
//   green = every contract passes  → ship-ready
//   red   = at least one contract is failing
export function ShipStatus() {
  const contracts = useStore((s) => s.contracts)
  const status = useStore((s) => s.contractStatus)
  const selectTable = useStore((s) => s.selectTable)
  const setInspectorTab = useStore((s) => s.setInspectorTab)

  const tables = Object.keys(contracts).filter((t) => (contracts[t]?.length ?? 0) > 0)

  let color = 'var(--text-faint)'
  let label = 'No contracts'
  let icon = '○'
  let firstFailing: string | null = null

  if (tables.length > 0) {
    let failing = 0
    let unchecked = 0
    for (const t of tables) {
      const st = status[t]
      if (!st) {
        unchecked++
      } else if (st.failed + st.errored > 0) {
        failing += st.failed + st.errored
        if (!firstFailing) firstFailing = t
      }
    }
    if (failing > 0) {
      color = 'var(--err)'
      icon = '✕'
      label = `${failing} contract issue${failing === 1 ? '' : 's'}`
    } else if (unchecked > 0) {
      color = 'var(--warn)'
      icon = '●'
      label = 'Checking…'
    } else {
      color = 'var(--ok)'
      icon = '✓'
      label = 'Ship-ready'
    }
  }

  const target = firstFailing || tables[0]

  return (
    <button
      className="ship-status"
      style={{ borderColor: color, color }}
      title={
        tables.length === 0
          ? 'No data contracts defined yet'
          : `Contracts across ${tables.length} table${tables.length === 1 ? '' : 's'}${
              firstFailing ? ` — click to inspect ${firstFailing}` : ''
            }`
      }
      disabled={!target}
      onClick={() => {
        if (target) {
          selectTable(target)
          setInspectorTab('contracts')
        }
      }}
    >
      <span className="dot" style={{ background: color }} />
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
