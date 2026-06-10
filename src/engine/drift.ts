// ---------------------------------------------------------------------------
// Drift monitoring — compare a "current" table against a "baseline" table,
// column by column, to catch silent data/distribution shift before it tanks a
// model or report. Fully client-side (DuckDB aggregates + TS math, no Pyodide).
//
// Headline metric is PSI (Population Stability Index):
//   < 0.10  ok       (no meaningful shift)
//   0.10–0.25 warn   (moderate shift)
//   > 0.25  drift    (significant shift)
// Plus null-rate change, mean shift (numeric), a KS-style statistic, and
// new/missing categories (categorical).
// ---------------------------------------------------------------------------

import { describeTable, countRows, queryArrow, arrowToRows } from './duck'
import type { DriftSpec } from '../types'

export type DriftStatus = 'ok' | 'warn' | 'drift'

export interface ColumnDrift {
  name: string
  kind: 'numeric' | 'categorical'
  psi: number
  status: DriftStatus
  baseNullPct: number
  curNullPct: number
  meanShiftPct?: number // numeric: relative change in mean
  ks?: number // numeric: max CDF gap across bins
  newCategories?: string[]
  missingCategories?: string[]
  note?: string
}

export interface DriftResult {
  baseline: string
  current: string
  baseRows: number
  curRows: number
  columns: ColumnDrift[]
  overall: DriftStatus
  driftedCount: number
}

const q = (n: string) => `"${n.replace(/"/g, '""')}"`
const isNumericType = (t: string) => /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/i.test(t)

function statusOf(psi: number): DriftStatus {
  if (psi > 0.25) return 'drift'
  if (psi >= 0.1) return 'warn'
  return 'ok'
}

function psiFromCounts(base: number[], cur: number[]): { psi: number; ks: number } {
  const bTot = base.reduce((a, b) => a + b, 0) || 1
  const cTot = cur.reduce((a, b) => a + b, 0) || 1
  let psi = 0
  let ks = 0
  let cumB = 0
  let cumC = 0
  for (let i = 0; i < base.length; i++) {
    let bp = base[i] / bTot
    let cp = cur[i] / cTot
    cumB += bp
    cumC += cp
    ks = Math.max(ks, Math.abs(cumB - cumC))
    bp = Math.max(bp, 1e-4)
    cp = Math.max(cp, 1e-4)
    psi += (cp - bp) * Math.log(cp / bp)
  }
  return { psi, ks }
}

/** Build a SELECT of 10 bin counts for `col` using baseline decile `edges`. */
function binCountsSelect(col: string, edges: number[]): string {
  const c = q(col)
  const parts: string[] = []
  parts.push(`SUM(CASE WHEN ${c} < ${edges[0]} THEN 1 ELSE 0 END) AS b0`)
  for (let i = 1; i < edges.length; i++) {
    parts.push(
      `SUM(CASE WHEN ${c} >= ${edges[i - 1]} AND ${c} < ${edges[i]} THEN 1 ELSE 0 END) AS b${i}`,
    )
  }
  parts.push(`SUM(CASE WHEN ${c} >= ${edges[edges.length - 1]} THEN 1 ELSE 0 END) AS b${edges.length}`)
  return parts.join(', ')
}

async function numericDrift(
  baseline: string,
  current: string,
  col: string,
  baseRows: number,
  curRows: number,
): Promise<ColumnDrift> {
  // Baseline decile edges.
  const qsel = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    .map((p, i) => `QUANTILE_CONT(${q(col)}, ${p})::DOUBLE AS q${i}`)
    .join(', ')
  const qrow = arrowToRows(
    await queryArrow(`SELECT ${qsel} FROM ${q(baseline)} WHERE ${q(col)} IS NOT NULL`),
  )[0] as Record<string, number> | undefined

  let edges = qrow ? Object.values(qrow).map((v) => Number(v)) : []
  edges = edges.filter((e) => e != null && isFinite(e))
  // Deduplicate while keeping ascending order (low-cardinality columns).
  edges = [...new Set(edges)].sort((a, b) => a - b)

  let psi = 0
  let ks = 0
  if (edges.length >= 1) {
    const baseCounts = arrowToRows(
      await queryArrow(`SELECT ${binCountsSelect(col, edges)} FROM ${q(baseline)}`),
    )[0] as Record<string, number>
    const curCounts = arrowToRows(
      await queryArrow(`SELECT ${binCountsSelect(col, edges)} FROM ${q(current)}`),
    )[0] as Record<string, number>
    const toArr = (o: Record<string, number>) =>
      Array.from({ length: edges.length + 1 }, (_, i) => Number(o[`b${i}`]) || 0)
    const r = psiFromCounts(toArr(baseCounts), toArr(curCounts))
    psi = r.psi
    ks = r.ks
  }

  // Null rates + mean shift.
  const stat = (t: string) =>
    queryArrow(
      `SELECT COUNT(*) FILTER (WHERE ${q(col)} IS NULL)::DOUBLE AS nulls,
              AVG(${q(col)}::DOUBLE) AS mean FROM ${q(t)}`,
    ).then((a) => arrowToRows(a)[0] as { nulls: number; mean: number })
  const bs = await stat(baseline)
  const cs = await stat(current)
  const meanShiftPct =
    bs.mean != null && cs.mean != null && bs.mean !== 0
      ? (Number(cs.mean) - Number(bs.mean)) / Math.abs(Number(bs.mean))
      : undefined

  return {
    name: col,
    kind: 'numeric',
    psi,
    status: statusOf(psi),
    baseNullPct: baseRows ? (Number(bs.nulls) / baseRows) * 100 : 0,
    curNullPct: curRows ? (Number(cs.nulls) / curRows) * 100 : 0,
    meanShiftPct,
    ks,
  }
}

async function categoricalDrift(
  baseline: string,
  current: string,
  col: string,
  baseRows: number,
  curRows: number,
): Promise<ColumnDrift> {
  const counts = (t: string) =>
    queryArrow(
      `SELECT ${q(col)}::VARCHAR AS v, COUNT(*)::DOUBLE AS c FROM ${q(t)}
       WHERE ${q(col)} IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 200`,
    ).then((a) => arrowToRows(a) as Array<{ v: string; c: number }>)
  const baseC = await counts(baseline)
  const curC = await counts(current)
  const bMap = new Map(baseC.map((r) => [r.v, Number(r.c)]))
  const cMap = new Map(curC.map((r) => [r.v, Number(r.c)]))
  const cats = [...new Set([...bMap.keys(), ...cMap.keys()])]
  const base = cats.map((k) => bMap.get(k) || 0)
  const cur = cats.map((k) => cMap.get(k) || 0)
  const { psi } = psiFromCounts(base, cur)

  const newCategories = [...cMap.keys()].filter((k) => !bMap.has(k))
  const missingCategories = [...bMap.keys()].filter((k) => !cMap.has(k))

  const nullStat = (t: string) =>
    queryArrow(
      `SELECT COUNT(*) FILTER (WHERE ${q(col)} IS NULL)::DOUBLE AS nulls FROM ${q(t)}`,
    ).then((a) => Number((arrowToRows(a)[0] as { nulls: number }).nulls))

  return {
    name: col,
    kind: 'categorical',
    psi,
    status: statusOf(psi),
    baseNullPct: baseRows ? ((await nullStat(baseline)) / baseRows) * 100 : 0,
    curNullPct: curRows ? ((await nullStat(current)) / curRows) * 100 : 0,
    newCategories: newCategories.slice(0, 10),
    missingCategories: missingCategories.slice(0, 10),
    note: newCategories.length || missingCategories.length ? 'category set changed' : undefined,
  }
}

export async function runDrift(spec: DriftSpec): Promise<DriftResult> {
  const { baseline, current } = spec
  if (!baseline || !current) throw new Error('Pick a baseline and a current table.')
  if (baseline === current) throw new Error('Baseline and current must be different tables.')

  const baseCols = await describeTable(baseline)
  const curCols = await describeTable(current)
  const curByName = new Map(curCols.map((c) => [c.name, c]))

  let shared = baseCols.filter((c) => curByName.has(c.name))
  if (spec.columns && spec.columns.length) {
    shared = shared.filter((c) => spec.columns!.includes(c.name))
  }
  if (!shared.length) throw new Error('No shared columns between the two tables.')

  const baseRows = await countRows(baseline)
  const curRows = await countRows(current)

  const columns: ColumnDrift[] = []
  for (const col of shared.slice(0, 40)) {
    try {
      const d = isNumericType(col.type)
        ? await numericDrift(baseline, current, col.name, baseRows, curRows)
        : await categoricalDrift(baseline, current, col.name, baseRows, curRows)
      columns.push(d)
    } catch (err) {
      columns.push({
        name: col.name,
        kind: isNumericType(col.type) ? 'numeric' : 'categorical',
        psi: 0,
        status: 'ok',
        baseNullPct: 0,
        curNullPct: 0,
        note: `skipped: ${String((err as Error).message)}`,
      })
    }
  }

  columns.sort((a, b) => b.psi - a.psi)
  const driftedCount = columns.filter((c) => c.status === 'drift').length
  const overall: DriftStatus = columns.some((c) => c.status === 'drift')
    ? 'drift'
    : columns.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok'

  return { baseline, current, baseRows, curRows, columns, overall, driftedCount }
}
