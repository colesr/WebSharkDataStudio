import { useStore } from '../state/store'
import type { ModelResult } from '../engine/model'
import type { ABResult } from '../engine/abtest'
import type { DriftResult } from '../engine/drift'

// A single at-a-glance "is this analysis production-ready?" indicator covering
// data contracts, trained models, AND A/B tests:
//   grey  = nothing to check yet
//   amber = contracts defined but not yet evaluated
//   green = every contract passes, every model beats baseline, no SRM mismatch
//   red   = a failing contract, a model not beating baseline, or an A/B SRM mismatch
export function ShipStatus() {
  const contracts = useStore((s) => s.contracts)
  const status = useStore((s) => s.contractStatus)
  const cells = useStore((s) => s.cells)
  const selectTable = useStore((s) => s.selectTable)
  const setInspectorTab = useStore((s) => s.setInspectorTab)
  const selectCell = useStore((s) => s.selectCell)

  const contractTables = Object.keys(contracts).filter((t) => (contracts[t]?.length ?? 0) > 0)
  const modelCells = cells.filter((c) => c.type === 'model' && c.output?.model)
  const abCells = cells.filter((c) => c.type === 'abtest' && c.output?.abtest)
  const driftCells = cells.filter((c) => c.type === 'drift' && c.output?.drift)

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

  // An A/B test with a sample-ratio-mismatch is a data-integrity red flag.
  // (A non-significant result is valid science, so it is NOT an "issue".)
  let abIssues = 0
  let firstFailingAB: string | null = null
  for (const c of abCells) {
    const r = c.output!.abtest as ABResult
    if (r.srm?.mismatch) {
      abIssues++
      if (!firstFailingAB) firstFailingAB = c.id
    }
  }

  // A drift cell with significant drift is a production red flag.
  let driftIssues = 0
  let firstFailingDrift: string | null = null
  for (const c of driftCells) {
    const r = c.output!.drift as DriftResult
    if (r.overall === 'drift') {
      driftIssues++
      if (!firstFailingDrift) firstFailingDrift = c.id
    }
  }

  const hasChecks =
    contractTables.length > 0 || modelCells.length > 0 || abCells.length > 0 || driftCells.length > 0
  const issues = contractIssues + modelIssues + abIssues + driftIssues

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
    } else if (firstFailingModel || firstFailingAB || firstFailingDrift) {
      const id = firstFailingModel || firstFailingAB || firstFailingDrift!
      selectCell(id)
      document.getElementById(`cell-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (contractTables[0]) {
      selectTable(contractTables[0])
      setInspectorTab('contracts')
    }
  }

  const parts: string[] = []
  if (contractTables.length) parts.push(`${contractTables.length} contract${contractTables.length === 1 ? '' : 's'}`)
  if (modelCells.length) parts.push(`${modelCells.length} model${modelCells.length === 1 ? '' : 's'}`)
  if (abCells.length) parts.push(`${abCells.length} A/B test${abCells.length === 1 ? '' : 's'}`)
  if (driftCells.length) parts.push(`${driftCells.length} drift check${driftCells.length === 1 ? '' : 's'}`)

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
