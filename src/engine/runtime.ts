// ---------------------------------------------------------------------------
// Execution orchestrator.
//
// Bridges the store and the engines: runs individual cells, cascades to
// reactive downstream dependents, refreshes the table catalog + data
// dictionary, and performs deterministic fresh-kernel run-all.
// ---------------------------------------------------------------------------

import { useStore } from '../state/store'
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
import { runPython, resetPython, onPythonLoad } from './python'
import { downstreamOf, topoOrder, cellDeps, pythonWrites } from './dag'
import { reloadSources, listSources } from './sources'
import { STRESS_ATTACKS, type StressResult } from './stress'
import { evaluateContract, summarize } from './contracts'

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

export function markStaleDownstream(cellId: string): void {
  const { cells, setCellStatus } = useStore.getState()
  for (const id of downstreamOf(cells, cellId)) {
    setCellStatus(id, 'stale')
  }
}

async function executeCell(cell: Cell): Promise<void> {
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
        // Rebuild the input from the pristine backup with this attack applied.
        const body = attack.build(bak, cols)
        await queryArrow(`CREATE OR REPLACE TABLE "${input}" AS ${body}`)
        r.inputRows = await countRows(input)

        // Run the transform on the mutated input.
        await executeCell(useStore.getState().cells.find((c) => c.id === targetId)!)
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
      if (t) await executeCell(t)
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

  await resetEngine()
  await resetPython()
  await reloadSources()
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
