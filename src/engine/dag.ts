// ---------------------------------------------------------------------------
// Reactive dependency graph.
//
// This is the answer to the "notebook executed out of order / hidden state"
// pain point. Each cell declares what tables it READS and what table it
// PRODUCES. From that we build a DAG: when a cell changes, every downstream
// dependent is marked stale and re-run in topological order. There is no
// hidden ordering — the graph is derived from the code itself.
// ---------------------------------------------------------------------------

import type { Cell } from '../types'
import { pythonDeps } from './python'

/** SQL keywords that may precede a table identifier we care about. */
const SQL_FROM_RE = /\b(?:from|join)\s+("?)([a-zA-Z_][a-zA-Z0-9_]*)\1/gi
const SQL_CTE_RE = /\bwith\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+as\b/gi
const SQL_CTE_EXTRA_RE = /,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\b/gi

/** Extract the table names a SQL statement reads (excluding its own CTEs). */
export function sqlReads(code: string): string[] {
  const ctes = new Set<string>()
  let m: RegExpExecArray | null
  const cteRe = new RegExp(SQL_CTE_RE)
  while ((m = cteRe.exec(code))) ctes.add(m[1].toLowerCase())
  const cteExtra = new RegExp(SQL_CTE_EXTRA_RE)
  while ((m = cteExtra.exec(code))) ctes.add(m[1].toLowerCase())

  const reads = new Set<string>()
  const fromRe = new RegExp(SQL_FROM_RE)
  while ((m = fromRe.exec(code))) {
    const name = m[2]
    if (!ctes.has(name.toLowerCase())) reads.add(name)
  }
  return [...reads]
}

export interface CellDeps {
  /** Tables this cell reads. */
  reads: string[]
  /** Table name this cell produces (if any). */
  produces?: string
}

export function cellDeps(cell: Cell): CellDeps {
  switch (cell.type) {
    case 'sql':
      return { reads: sqlReads(cell.code), produces: cell.name || undefined }
    case 'python': {
      const { reads, writes } = pythonDeps(cell.code)
      // A python cell may publish several tables; the DAG keys on the first,
      // but we expose all writes via producesAll for table tracking.
      return { reads, produces: writes[0] }
    }
    case 'chart':
      return { reads: cell.chart?.table ? [cell.chart.table] : [] }
    case 'profile':
      return { reads: cell.profileTarget ? [cell.profileTarget] : [] }
    default:
      return { reads: [] }
  }
}

export function pythonWrites(cell: Cell): string[] {
  if (cell.type !== 'python') return []
  return pythonDeps(cell.code).writes
}

interface GraphNode {
  cell: Cell
  deps: CellDeps
}

/**
 * Build a producer map (table name -> cell id) and adjacency for the DAG.
 * Returns a topologically sorted list of cell ids.
 */
export function buildGraph(cells: Cell[]) {
  const nodes: GraphNode[] = cells.map((cell) => ({ cell, deps: cellDeps(cell) }))

  // Map produced table -> producing cell id (later cells win on conflict).
  const producer = new Map<string, string>()
  for (const n of nodes) {
    const writes =
      n.cell.type === 'python' ? pythonWrites(n.cell) : n.deps.produces ? [n.deps.produces] : []
    for (const w of writes) producer.set(w.toLowerCase(), n.cell.id)
  }

  // Edges: producer cell -> consumer cell.
  const downstream = new Map<string, Set<string>>()
  const upstream = new Map<string, Set<string>>()
  for (const n of nodes) {
    downstream.set(n.cell.id, new Set())
    upstream.set(n.cell.id, new Set())
  }
  for (const n of nodes) {
    for (const r of n.deps.reads) {
      const prodId = producer.get(r.toLowerCase())
      if (prodId && prodId !== n.cell.id) {
        downstream.get(prodId)!.add(n.cell.id)
        upstream.get(n.cell.id)!.add(prodId)
      }
    }
  }

  return { nodes, producer, downstream, upstream }
}

/** Topological order of cell ids (falls back to document order on cycles). */
export function topoOrder(cells: Cell[]): string[] {
  const { downstream, upstream } = buildGraph(cells)
  const order: string[] = []
  const indeg = new Map<string, number>()
  for (const c of cells) indeg.set(c.id, upstream.get(c.id)!.size)

  // Seed with zero-indegree cells in document order (stable).
  const queue = cells.filter((c) => (indeg.get(c.id) || 0) === 0).map((c) => c.id)
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    for (const d of downstream.get(id) || []) {
      indeg.set(d, (indeg.get(d) || 1) - 1)
      if ((indeg.get(d) || 0) <= 0) queue.push(d)
    }
  }
  // Any remaining (cycles) appended in document order.
  for (const c of cells) if (!seen.has(c.id)) order.push(c.id)
  return order
}

/** All cells downstream of a given cell (transitive), in topo order. */
export function downstreamOf(cells: Cell[], cellId: string): string[] {
  const { downstream } = buildGraph(cells)
  const result = new Set<string>()
  const stack = [...(downstream.get(cellId) || [])]
  while (stack.length) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    for (const d of downstream.get(id) || []) stack.push(d)
  }
  const order = topoOrder(cells)
  return order.filter((id) => result.has(id))
}
