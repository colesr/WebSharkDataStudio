// ---------------------------------------------------------------------------
// Execution orchestrator.
//
// Bridges the store and the engines: runs individual cells, cascades to
// reactive downstream dependents, refreshes the table catalog + data
// dictionary, and performs deterministic fresh-kernel run-all.
// ---------------------------------------------------------------------------

import { useStore, newId } from '../state/store'
import type { Cell, ColumnMeta, TableMeta } from '../types'
import {
  listTables,
  describeTable,
  countRows,
  queryPreview,
  queryArrow,
  resetEngine,
} from './duck'
import { profileColumns } from './semantic'
import { profileTable } from './profile'
import { buildVegaSpec } from './chartspec'
import { runPython, runModel, resetPython, onPythonLoad } from './python'
import { downstreamOf, topoOrder, cellDeps, pythonWrites } from './dag'
import { reloadSources, listSources } from './sources'
import { STRESS_ATTACKS, type StressResult } from './stress'
import { evaluateContract, summarize } from './contracts'
import { runABTest } from './abtest'
import { runDrift } from './drift'
import { withTask, logActivity } from '../state/activity'

// Forward Python load progress into the store for the loading indicator.
onPythonLoad((stage) => {
  const s = useStore.getState()
  s.setPythonStage(stage === 'Python ready' ? null : stage)
})

/** Refresh the table catalog and (re)build the data dictionary. */
export async function refreshCatalog(): Promise<void> {
  // Hide internal scratch tables (e.g. stress-test backups) from the catalog.
  const names = (await listTables()).filter((n) => !n.startsWith('__'))
  const prevTables = useStore.getState().tables
  const prevDict = useStore.getState().dictionary
  const tables: Record<string, TableMeta> = {}

  // Determine each table's provenance: source registry > python output > sql.
  const sourceMap = new Map(listSources().map((s) => [s.name, s.source]))
  const pyTables = new Set<string>()
  for (const c of useStore.getState().cells) for (const w of pythonWrites(c)) pyTables.add(w)

  for (const name of names) {
    const cols = await describeTable(name)
    const rowCount = await countRows(name)
    const prevMeta = prevTables[name]
    const source: TableMeta['source'] =
      sourceMap.get(name) ?? (pyTables.has(name) ? 'python' : prevMeta?.source ?? 'sql')
    tables[name] = {
      name,
      rowCount,
      source,
      origin: prevMeta?.origin,
      columns: prevDict[name] ?? [],
    }
    // (Re)build dictionary only when missing or column set changed.
    const existing = prevDict[name]
    const sameCols =
      existing &&
      existing.length === cols.length &&
      existing.every((c, i) => c.name === cols[i].name && c.physicalType === cols[i].type)
    if (!sameCols) {
      const fresh = await profileColumns(name)
      // Preserve user-edited descriptions/tags where column names match.
      if (existing) {
        const byName = new Map(existing.map((c) => [c.name, c]))
        for (const f of fresh) {
          const old = byName.get(f.name)
          if (old) {
            f.description = old.description
            f.tags = old.tags
          }
        }
      }
      useStore.getState().setDictionary(name, fresh)
      tables[name].columns = fresh
    }
  }

  // Drop dictionary entries for tables that no longer exist.
  useStore.getState().setTables(tables)

  // Real-time contracts: re-evaluate every defined contract against the
  // freshly-updated tables so the sidebar status + Inspector reflect the
  // current data after any run.
  await autoCheckContracts(tables)
}

/** Evaluate all defined contracts against current tables and store results. */
export async function autoCheckContracts(
  tables: Record<string, TableMeta>,
): Promise<void> {
  const store = useStore.getState()
  const { contracts } = store
  for (const [table, rules] of Object.entries(contracts)) {
    if (!rules.length) continue
    if (!tables[table]) {
      // Table gone — clear any stale status.
      store.clearContractResults(table)
      continue
    }
    try {
      const results = await evaluateContract(table, rules)
      store.setContractResults(table, results, summarize(results))
    } catch (err) {
      console.warn(`Contract check failed for ${table}`, err)
    }
  }
}

/**
 * Re-render "view" cells (charts + profiles) that have a complete config and
 * whose source table exists. These outputs aren't persisted in the project, so
 * after a reload or project-open they must be recomputed to reappear. They're
 * cheap and read existing tables, so it's safe to run them automatically
 * (unlike SQL/Python, which may be expensive and stay stale until run).
 */
export async function rerenderViewCells(): Promise<void> {
  const { cells, tables } = useStore.getState()
  for (const c of cells) {
    const ready =
      (c.type === 'chart' && c.chart?.table && tables[c.chart.table]) ||
      (c.type === 'profile' && c.profileTarget && tables[c.profileTarget])
    if (!ready) continue
    const cell = useStore.getState().cells.find((x) => x.id === c.id)
    if (!cell) continue
    try {
      await executeCell(cell)
    } catch {
      /* leave the cell's empty/error state */
    }
  }
}

export function markStaleDownstream(cellId: string): void {
  const { cells, setCellStatus } = useStore.getState()
  for (const id of downstreamOf(cells, cellId)) {
    setCellStatus(id, 'stale')
  }
}

/** A human label for the activity log, or null for cells that don't "run". */
function cellLabel(cell: Cell): string | null {
  switch (cell.type) {
    case 'sql':
      return cell.code.trim() ? `Running SQL${cell.name ? ` → ${cell.name}` : ''}` : null
    case 'python':
      return cell.code.trim() ? 'Running Python' : null
    case 'chart':
      return cell.chart?.table ? `Rendering chart · ${cell.chart.table}` : null
    case 'profile':
      return cell.profileTarget ? `Profiling ${cell.profileTarget}` : null
    case 'stress':
      return cell.stressTarget?.cellId ? 'Stress-testing transform' : null
    case 'model':
      return cell.model?.target ? `Training ${cell.model.algo} → ${cell.model.target}` : null
    case 'abtest':
      return cell.abtest?.variantCol && cell.abtest?.metricCol
        ? `A/B test · ${cell.abtest.metricCol} by ${cell.abtest.variantCol}`
        : null
    case 'drift':
      return cell.drift?.baseline && cell.drift?.current
        ? `Drift · ${cell.drift.baseline} → ${cell.drift.current}`
        : null
    default:
      return null
  }
}

/** Execute a cell, logging it to the activity console (envelope + busy). */
function executeCell(cell: Cell): Promise<void> {
  const label = cellLabel(cell)
  return label ? withTask(label, () => executeCellInner(cell)) : executeCellInner(cell)
}

async function executeCellInner(cell: Cell): Promise<void> {
  const store = useStore.getState()
  const { project, setCellStatus, setCellOutput } = store
  const t0 = performance.now()
  setCellStatus(cell.id, 'running')

  try {
    if (cell.type === 'markdown') {
      setCellOutput(cell.id, undefined)
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'sql') {
      const code = cell.code.trim().replace(/;\s*$/, '')
      if (!code) {
        setCellOutput(cell.id, undefined)
        setCellStatus(cell.id, 'ok')
        return
      }
      // If the cell names an output, materialize it as a table first.
      if (cell.name) {
        await queryArrow(`DROP TABLE IF EXISTS "${cell.name}"`)
        await queryArrow(`CREATE TABLE "${cell.name}" AS ${code}`)
        const preview = await queryPreview(`SELECT * FROM "${cell.name}"`)
        setCellOutput(cell.id, { table: preview, durationMs: performance.now() - t0 })
      } else {
        const preview = await queryPreview(code)
        setCellOutput(cell.id, { table: preview, durationMs: performance.now() - t0 })
      }
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'python') {
      const res = await runPython(cell.code, project.seed)
      let preview
      // If the cell published a table, preview the first published one.
      const writes = pythonWrites(cell)
      if (writes.length) {
        preview = await queryPreview(`SELECT * FROM "${writes[0]}"`)
      }
      const textOut = res.result ? `${res.stdout || ''}${res.result}` : res.stdout || undefined
      setCellOutput(cell.id, {
        text: textOut,
        table: preview,
        image: res.image,
        durationMs: performance.now() - t0,
      })
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'chart') {
      if (!cell.chart?.table) {
        setCellStatus(cell.id, 'idle')
        return
      }
      const spec = await buildVegaSpec(cell.chart)
      setCellOutput(cell.id, { vegaSpec: spec, durationMs: performance.now() - t0 })
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'profile') {
      if (!cell.profileTarget) {
        setCellStatus(cell.id, 'idle')
        return
      }
      const prof = await profileTable(cell.profileTarget)
      setCellOutput(cell.id, { profile: prof, durationMs: performance.now() - t0 })
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'stress') {
      const results = await runStress(cell)
      setCellOutput(cell.id, { stress: results, durationMs: performance.now() - t0 })
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'abtest') {
      const spec = cell.abtest
      if (!spec?.table || !spec.variantCol || !spec.metricCol) {
        setCellStatus(cell.id, 'idle')
        return
      }
      const result = await runABTest(spec)
      setCellOutput(cell.id, { abtest: result, durationMs: performance.now() - t0 })
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'drift') {
      const spec = cell.drift
      if (!spec?.baseline || !spec.current) {
        setCellStatus(cell.id, 'idle')
        return
      }
      const result = await runDrift(spec)
      setCellOutput(cell.id, { drift: result, durationMs: performance.now() - t0 })
      setCellStatus(cell.id, 'ok')
      return
    }

    if (cell.type === 'model') {
      const spec = cell.model
      if (!spec?.table || !spec.target) {
        setCellStatus(cell.id, 'idle')
        return
      }
      const result = await runModel({
        table: spec.table,
        target: spec.target,
        features: spec.features ?? [],
        algo: spec.algo,
        seed: project.seed,
      })
      setCellOutput(cell.id, { model: result, durationMs: performance.now() - t0 })
      setCellStatus(cell.id, 'ok')
      // Log this run into the experiment tracker.
      const deltas = result.stress
        .map((s) => (s.metric == null ? null : s.metric - s.clean))
        .filter((d): d is number => d != null)
      useStore.getState().addExperiment({
        id: newId('exp'),
        ts: new Date().toISOString(),
        cellId: cell.id,
        table: spec.table,
        target: spec.target,
        task: result.task,
        algo: result.algo,
        nFeatures: result.nFeatures,
        nTrain: result.nTrain,
        nTest: result.nTest,
        seed: project.seed,
        primaryName: result.primaryMetric.name,
        primaryModel: result.primaryMetric.model,
        primaryBaseline: result.primaryMetric.baseline,
        beatsBaseline: result.beatsBaseline,
        metrics: result.metrics,
        leakageCount: result.leakage.length,
        worstStressDelta: deltas.length ? Math.min(...deltas) : null,
      })
      return
    }
  } catch (err) {
    setCellOutput(cell.id, { error: String((err as Error).message || err) })
    setCellStatus(cell.id, 'error')
    throw err
  }
}

/**
 * Stress-test a target transform cell: back up its input table, then rebuild
 * that input from a library of adversarial / degenerate / scaled-up mutations,
 * re-run the transform on each, and grade the outcome. Always restores the
 * real input + output in a finally block.
 */
async function runStress(stressCell: Cell): Promise<StressResult[]> {
  const cells = useStore.getState().cells
  const targetId = stressCell.stressTarget?.cellId
  const target = cells.find((c) => c.id === targetId)
  if (!target) throw new Error('Pick a SQL or Python transform cell to stress-test.')

  const deps = cellDeps(target)
  const input = deps.reads[0]
  const output = target.type === 'python' ? pythonWrites(target)[0] : deps.produces
  if (!input) throw new Error('The target cell does not read any table.')
  if (!output) throw new Error('The target cell must produce a named output table.')

  const cols = await describeTable(input)
  const bak = `__wsbak_stress`
  const contracts = useStore.getState().contracts

  // Back up the pristine input; baseline output schema is captured in-loop.
  await queryArrow(`CREATE OR REPLACE TABLE "${bak}" AS SELECT * FROM "${input}"`)

  const results: StressResult[] = []
  let baselineSchema: string[] = []

  try {
    for (const attack of STRESS_ATTACKS) {
      const a0 = performance.now()
      let r: StressResult = {
        attack: attack.key,
        label: attack.label,
        status: 'ok',
        inputRows: 0,
        durationMs: 0,
      }
      try {
        logActivity(`Stress: ${attack.label}`)
        // Rebuild the input from the pristine backup with this attack applied.
        const body = attack.build(bak, cols)
        await queryArrow(`CREATE OR REPLACE TABLE "${input}" AS ${body}`)
        r.inputRows = await countRows(input)

        // Run the transform on the mutated input.
        await executeCellInner(useStore.getState().cells.find((c) => c.id === targetId)!)
        const ran = useStore.getState().cells.find((c) => c.id === targetId)!
        if (ran.status === 'error') {
          r.status = 'error'
          r.message = ran.output?.error
        } else {
          r.outputRows = await countRows(output)
          const schema = (await describeTable(output)).map((c) => c.name)
          if (attack.key === 'baseline') baselineSchema = schema
          else if (baselineSchema.length && schema.join('|') !== baselineSchema.join('|')) {
            r.schemaChanged = true
            r.status = 'warning'
            r.message = 'output schema changed'
          }
          // Evaluate any contract defined on the output table.
          if (contracts[output]?.length) {
            const res = await evaluateContract(output, contracts[output])
            const sum = summarize(res)
            r.contractFailures = sum.failed + sum.errored
            if (r.contractFailures > 0) {
              r.status = r.status === 'error' ? 'error' : 'warning'
              r.message = `${r.contractFailures} contract rule(s) failed`
            }
          }
        }
      } catch (err) {
        r.status = 'error'
        r.message = String((err as Error).message || err)
      }
      r.durationMs = performance.now() - a0
      results.push(r)
    }
  } finally {
    // Restore the real input and recompute the real output.
    try {
      await queryArrow(`CREATE OR REPLACE TABLE "${input}" AS SELECT * FROM "${bak}"`)
      await queryArrow(`DROP TABLE IF EXISTS "${bak}"`)
      const t = useStore.getState().cells.find((c) => c.id === targetId)
      if (t) await executeCellInner(t)
    } catch (err) {
      console.warn('Failed to restore after stress test', err)
    }
    await refreshCatalog()
  }

  return results
}

/** Run a single cell, then cascade to its reactive downstream dependents. */
export async function runCell(cellId: string, cascade = true): Promise<void> {
  const cells = useStore.getState().cells
  const cell = cells.find((c) => c.id === cellId)
  if (!cell) return
  try {
    await executeCell(cell)
  } catch {
    return // stop cascade on error
  }
  await refreshCatalog()

  if (!cascade) return
  const down = downstreamOf(useStore.getState().cells, cellId)
  for (const id of down) {
    const c = useStore.getState().cells.find((x) => x.id === id)
    if (!c) continue
    try {
      await executeCell(c)
    } catch {
      break
    }
  }
  await refreshCatalog()
}

/** Deterministic reproduction: reset engine + python, reload sources, run all. */
export async function runAllFresh(): Promise<void> {
  const { cells, setCellStatus } = useStore.getState()
  for (const c of cells) setCellStatus(c.id, 'stale')

  logActivity('Run fresh: resetting engine & Python…', 'info')
  await resetEngine()
  await resetPython()
  await withTask('Reloading source datasets', () => reloadSources())
  await refreshCatalog()

  const order = topoOrder(useStore.getState().cells)
  for (const id of order) {
    const c = useStore.getState().cells.find((x) => x.id === id)
    if (!c) continue
    try {
      await executeCell(c)
    } catch {
      // Continue running independent branches even if one cell fails.
    }
  }
  await refreshCatalog()
}

/** Run every cell in document/topo order without resetting (in-session). */
export async function runAll(): Promise<void> {
  logActivity('Run all', 'info')
  const order = topoOrder(useStore.getState().cells)
  for (const id of order) {
    const c = useStore.getState().cells.find((x) => x.id === id)
    if (!c) continue
    try {
      await executeCell(c)
    } catch {
      /* continue */
    }
  }
  await refreshCatalog()
}

export { cellDeps }
