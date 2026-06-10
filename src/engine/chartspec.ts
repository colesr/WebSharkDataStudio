// ---------------------------------------------------------------------------
// Build a Vega-Lite spec from a point-and-click ChartSpec, with the data
// inlined so charts serialize cleanly into projects and exported reports.
// ---------------------------------------------------------------------------

import { queryArrow, arrowToRows, describeTable } from './duck'
import type { ChartSpec } from '../types'

function resolveType(
  declared: string | undefined,
  field: string | undefined,
  physical: Map<string, string>,
): 'quantitative' | 'nominal' | 'temporal' | 'ordinal' {
  if (declared && declared !== 'auto')
    return declared as 'quantitative' | 'nominal' | 'temporal' | 'ordinal'
  if (!field) return 'nominal'
  const t = (physical.get(field) || '').toUpperCase()
  if (/DATE|TIME|TIMESTAMP/.test(t)) return 'temporal'
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return 'quantitative'
  return 'nominal'
}

export async function buildVegaSpec(chart: ChartSpec): Promise<unknown> {
  if (!chart.table) throw new Error('No table selected for chart')
  const cols = await describeTable(chart.table)
  const physical = new Map(cols.map((c) => [c.name, c.type]))

  // Pull a bounded number of rows for the chart.
  const arrow = await queryArrow(`SELECT * FROM "${chart.table}" LIMIT 10000`)
  const rows = arrowToRows(arrow)

  const agg = chart.aggregate && chart.aggregate !== 'none' ? chart.aggregate : undefined
  const encoding: Record<string, unknown> = {}

  if (chart.x) {
    encoding.x = {
      field: chart.x,
      type: resolveType(chart.xType, chart.x, physical),
    }
  }
  if (chart.y) {
    const yEnc: Record<string, unknown> = {
      field: chart.y,
      type: resolveType(chart.yType, chart.y, physical),
    }
    if (agg) yEnc.aggregate = agg
    encoding.y = yEnc
  } else if (agg === 'count') {
    encoding.y = { aggregate: 'count', type: 'quantitative' }
  }
  if (chart.color) {
    encoding.color = {
      field: chart.color,
      type: resolveType(undefined, chart.color, physical),
    }
  }

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    background: 'transparent',
    width: 'container',
    height: 280,
    data: { values: rows },
    mark: { type: chart.mark, tooltip: true, point: chart.mark === 'line' },
    encoding,
  }
}
