// ---------------------------------------------------------------------------
// One-click table profiling — the EDA fast-path.
//
// Everything is computed as in-engine DuckDB SQL (fast, no data leaves the
// table) and shaped into compact per-column summaries with Vega-Lite mini
// histograms, plus a numeric correlation matrix.
// ---------------------------------------------------------------------------

import { describeTable, queryArrow, countRows } from './duck'

export interface ColumnProfile {
  name: string
  type: string
  kind: 'numeric' | 'datetime' | 'boolean' | 'string'
  nullPct: number
  distinct: number
  // numeric stats
  min?: number
  max?: number
  mean?: number
  std?: number
  p25?: number
  p50?: number
  p75?: number
  // distributions
  histogram?: { bin: string; count: number }[]
  topValues?: { value: string; count: number }[]
}

export interface TableProfile {
  table: string
  rowCount: number
  columns: ColumnProfile[]
  correlations?: { a: string; b: string; r: number }[]
  numericColumns: string[]
}

function kindOf(type: string): ColumnProfile['kind'] {
  const t = type.toUpperCase()
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return 'numeric'
  if (/DATE|TIME|TIMESTAMP/.test(t)) return 'datetime'
  if (/BOOL/.test(t)) return 'boolean'
  return 'string'
}

async function numericStats(table: string, col: string) {
  const res = await queryArrow(`SELECT
      MIN("${col}")::DOUBLE AS mn,
      MAX("${col}")::DOUBLE AS mx,
      AVG("${col}")::DOUBLE AS mean,
      STDDEV_SAMP("${col}")::DOUBLE AS std,
      QUANTILE_CONT("${col}", 0.25)::DOUBLE AS p25,
      QUANTILE_CONT("${col}", 0.5)::DOUBLE AS p50,
      QUANTILE_CONT("${col}", 0.75)::DOUBLE AS p75
    FROM "${table}"`)
  const r = res.get(0) as Record<string, number> | null
  return r
    ? {
        min: r.mn,
        max: r.mx,
        mean: r.mean,
        std: r.std,
        p25: r.p25,
        p50: r.p50,
        p75: r.p75,
      }
    : {}
}

async function numericHistogram(
  table: string,
  col: string,
  min: number,
  max: number,
  bins = 20,
): Promise<{ bin: string; count: number }[]> {
  if (!isFinite(min) || !isFinite(max) || min === max) {
    return [{ bin: String(min ?? ''), count: await countRows(table) }]
  }
  const width = (max - min) / bins
  const res = await queryArrow(`
    WITH b AS (
      SELECT LEAST(${bins - 1},
        FLOOR(("${col}" - ${min}) / ${width}))::INT AS bin
      FROM "${table}" WHERE "${col}" IS NOT NULL
    )
    SELECT bin, COUNT(*)::DOUBLE AS count FROM b GROUP BY bin ORDER BY bin`)
  const rows = res.toArray() as Array<{ bin: number; count: number }>
  return rows.map((r) => {
    const lo = min + r.bin * width
    return { bin: lo.toPrecision(3), count: Number(r.count) }
  })
}

async function topValues(
  table: string,
  col: string,
  limit = 10,
): Promise<{ value: string; count: number }[]> {
  const res = await queryArrow(`
    SELECT "${col}"::VARCHAR AS value, COUNT(*)::DOUBLE AS count
    FROM "${table}" WHERE "${col}" IS NOT NULL
    GROUP BY 1 ORDER BY count DESC LIMIT ${limit}`)
  return (res.toArray() as Array<{ value: string; count: number }>).map((r) => ({
    value: r.value,
    count: Number(r.count),
  }))
}

async function correlations(
  table: string,
  cols: string[],
): Promise<{ a: string; b: string; r: number }[]> {
  const out: { a: string; b: string; r: number }[] = []
  // Limit to a reasonable number of numeric columns to bound cost.
  const use = cols.slice(0, 8)
  for (let i = 0; i < use.length; i++) {
    for (let j = i; j < use.length; j++) {
      const a = use[i]
      const b = use[j]
      if (a === b) {
        out.push({ a, b, r: 1 })
        continue
      }
      try {
        const res = await queryArrow(
          `SELECT CORR("${a}", "${b}")::DOUBLE AS r FROM "${table}"`,
        )
        const row = res.get(0) as { r: number } | null
        const r = row && row.r != null ? Number(row.r) : 0
        out.push({ a, b, r })
        out.push({ a: b, b: a, r })
      } catch {
        /* ignore */
      }
    }
  }
  return out
}

export async function profileTable(table: string): Promise<TableProfile> {
  const cols = await describeTable(table)
  const rowCount = await countRows(table)
  const columns: ColumnProfile[] = []
  const numericColumns: string[] = []

  for (const col of cols) {
    const kind = kindOf(col.type)
    const stat = await queryArrow(`SELECT
        COUNT(*) FILTER (WHERE "${col.name}" IS NULL)::DOUBLE AS nulls,
        COUNT(DISTINCT "${col.name}")::DOUBLE AS distinct
      FROM "${table}"`)
    const srow = stat.get(0) as { nulls: number; distinct: number } | null
    const nulls = srow ? Number(srow.nulls) : 0
    const distinct = srow ? Number(srow.distinct) : 0

    const profile: ColumnProfile = {
      name: col.name,
      type: col.type,
      kind,
      nullPct: rowCount > 0 ? (nulls / rowCount) * 100 : 0,
      distinct,
    }

    if (kind === 'numeric') {
      numericColumns.push(col.name)
      Object.assign(profile, await numericStats(table, col.name))
      if (profile.min != null && profile.max != null) {
        profile.histogram = await numericHistogram(
          table,
          col.name,
          profile.min,
          profile.max,
        )
      }
    } else {
      profile.topValues = await topValues(table, col.name)
    }
    columns.push(profile)
  }

  const corr =
    numericColumns.length >= 2
      ? await correlations(table, numericColumns)
      : undefined

  return { table, rowCount, columns, correlations: corr, numericColumns }
}
