// ---------------------------------------------------------------------------
// A/B test analysis — two-sample experiment comparison, fully client-side.
//
// DuckDB does the aggregation; TypeScript does the statistics (no Pyodide):
//   - proportion metric → two-proportion z-test
//   - continuous metric → Welch's t-test
// Plus a sample-ratio-mismatch (SRM) chi-square check — a data-integrity guard
// that flags broken randomization/logging before you trust any result.
// ---------------------------------------------------------------------------

import { queryArrow, arrowToRows } from './duck'
import { normalCdf, studentTwoTailedP, chiSquareP } from './stats'
import type { ABSpec } from '../types'

export interface ABVariant {
  name: string
  n: number
  mean: number // rate for proportion, mean for continuous
  std: number
  isControl: boolean
}

export interface ABComparison {
  variant: string
  absDiff: number
  lift: number | null // relative to control mean
  ci: [number, number] // 95% CI on the absolute difference
  pValue: number
  significant: boolean
}

export interface ABResult {
  metricType: 'mean' | 'proportion'
  control: string
  alpha: number
  variants: ABVariant[]
  comparisons: ABComparison[]
  srm: { chi2: number; pValue: number; mismatch: boolean; expectedShare: number }
  warnings: string[]
}

const q = (n: string) => `"${n.replace(/"/g, '""')}"`

export async function runABTest(spec: ABSpec): Promise<ABResult> {
  const { table, variantCol, metricCol, metricType } = spec
  const alpha = spec.alpha ?? 0.05
  if (!table || !variantCol || !metricCol) {
    throw new Error('Pick a table, a variant column, and a metric column.')
  }

  // One pass of per-variant aggregates in DuckDB.
  const sql = `
    SELECT ${q(variantCol)}::VARCHAR AS variant,
           COUNT(*)::DOUBLE AS n,
           AVG(${q(metricCol)}::DOUBLE) AS mean,
           COALESCE(VAR_SAMP(${q(metricCol)}::DOUBLE), 0) AS var
    FROM ${q(table)}
    WHERE ${q(variantCol)} IS NOT NULL AND ${q(metricCol)} IS NOT NULL
    GROUP BY 1 ORDER BY 1`
  const rows = arrowToRows(await queryArrow(sql)) as Array<{
    variant: string
    n: number
    mean: number
    var: number
  }>

  if (rows.length < 2) {
    throw new Error('Need at least two variants with data to compare.')
  }

  const controlName = spec.control && rows.some((r) => r.variant === spec.control)
    ? spec.control
    : rows[0].variant

  const warnings: string[] = []
  if (metricType === 'proportion') {
    const bad = rows.find((r) => r.mean < -1e-9 || r.mean > 1 + 1e-9)
    if (bad) warnings.push(`Proportion metric "${metricCol}" has values outside [0,1] (e.g. ${controlName}). Use a 0/1 or boolean column.`)
  }

  const variants: ABVariant[] = rows.map((r) => ({
    name: r.variant,
    n: Number(r.n),
    mean: Number(r.mean),
    std: Math.sqrt(Math.max(0, Number(r.var))),
    isControl: r.variant === controlName,
  }))

  const control = variants.find((v) => v.isControl)!
  const comparisons: ABComparison[] = []

  for (const v of variants) {
    if (v.isControl) continue
    const absDiff = v.mean - control.mean
    let se: number
    let pValue: number

    if (metricType === 'proportion') {
      // Two-proportion z-test (pooled SE for the test).
      const p1 = control.mean
      const p2 = v.mean
      const n1 = control.n
      const n2 = v.n
      const pPool = (p1 * n1 + p2 * n2) / (n1 + n2)
      const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2))
      const z = sePool > 0 ? absDiff / sePool : 0
      pValue = 2 * (1 - normalCdf(Math.abs(z)))
      // Unpooled SE for the CI.
      se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)
    } else {
      // Welch's t-test for means.
      const s1 = control.std ** 2 / control.n
      const s2 = v.std ** 2 / v.n
      se = Math.sqrt(s1 + s2)
      const t = se > 0 ? absDiff / se : 0
      const df = se > 0 ? (s1 + s2) ** 2 / (s1 ** 2 / (control.n - 1) + s2 ** 2 / (v.n - 1)) : 1
      pValue = studentTwoTailedP(t, df)
    }

    const margin = 1.96 * se
    comparisons.push({
      variant: v.name,
      absDiff,
      lift: control.mean !== 0 ? absDiff / control.mean : null,
      ci: [absDiff - margin, absDiff + margin],
      pValue,
      significant: pValue < alpha,
    })
  }

  // Sample-ratio-mismatch: chi-square vs an equal split across variants.
  const total = variants.reduce((s, v) => s + v.n, 0)
  const expected = total / variants.length
  const chi2 = variants.reduce((s, v) => s + (v.n - expected) ** 2 / expected, 0)
  const srmP = chiSquareP(chi2, variants.length - 1)

  return {
    metricType,
    control: controlName,
    alpha,
    variants,
    comparisons,
    srm: {
      chi2,
      pValue: srmP,
      mismatch: srmP < 0.001,
      expectedShare: 1 / variants.length,
    },
    warnings,
  }
}
