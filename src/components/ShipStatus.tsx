import { useStore } from '../state/store'
import type { ModelResult } from '../engine/model'

// A single at-a-glance "is this analysis production-ready?" indicator covering
// BOTH data contracts and trained models:
//   grey  = nothing to check yet
//   amber = contracts defined but not yet evaluated
//   green = every contract passes AND every model beats its baseline
//   red   = at least one contract failing or one model not beating baseline
export function ShipStatus() {
  const contracts = useStore((s) => s.contracts)
  const status = useStore((s) => s.contractStatus)
  const cells = useStore((s) => s.cells)
  const selectTable = useStore((s) => s.selectTable)
  const setInspectorTab = useStore((s) => s.setInspectorTab)
  const selectCell = useStore((s) => s.selectCell)

  const contractTables = Object.keys(contracts).filter((t) => (contracts[t]?.length ?? 0) > 0)
  const modelCells = cells.filter((c) => c.type === 'model' && c.output?.model)

  let contractIssues = 0
  let unchecked = 0
  let firstFailingTable: string | null = null
  for (const t of contractTables) {
    const st = status[t]
    if (!st) unchecked++
    else if (st.failed + st.errored > 0) {
      contractIssues += st.failed + st.errored
      if (!firstFailingTable) firstFailingTable = t
    }
  }

  let modelIssues = 0
  let firstFailingModel: string | null = null
  for (const c of modelCells) {
    const r = c.output!.model as ModelResult
    if (!r.beatsBaseline) {
      modelIssues++
      if (!firstFailingModel) firstFailingModel = c.id
    }
  }

  const hasChecks = contractTables.length > 0 || modelCells.length > 0
  const issues = contractIssues + modelIssues

  let color = 'var(--text-faint)'
  let icon = '○'
  let label = 'No checks'
  if (hasChecks) {
    if (issues > 0) {
      color = 'var(--err)'
      icon = '✕'
      label = `${issues} issue${issues === 1 ? '' : 's'}`
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

  function go() {
    if (firstFailingTable) {
      selectTable(firstFailingTable)
      setInspectorTab('contracts')
    } else if (firstFailingModel) {
      selectCell(firstFailingModel)
      document.getElementById(`cell-${firstFailingModel}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (contractTables[0]) {
      selectTable(contractTables[0])
      setInspectorTab('contracts')
    }
  }

  const parts: string[] = []
  if (contractTables.length) parts.push(`${contractTables.length} contract${contractTables.length === 1 ? '' : 's'}`)
  if (modelCells.length) parts.push(`${modelCells.length} model${modelCells.length === 1 ? '' : 's'}`)

  return (
    <button
      className="ship-status"
      style={{ borderColor: color, color }}
      title={hasChecks ? `Ship-readiness across ${parts.join(' + ')}` : 'Add contracts or train a model to track ship-readiness'}
      disabled={!hasChecks}
      onClick={go}
    >
      <span className="dot" style={{ background: color }} />
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
