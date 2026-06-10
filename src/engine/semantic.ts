// ---------------------------------------------------------------------------
// Semantic type inference for the data dictionary.
//
// Fights the "columns nobody remembers" pain point: every loaded table gets a
// best-effort guess at what each column *means* (not just its physical type),
// plus null %, distinct count, and sample values — all editable.
// ---------------------------------------------------------------------------

import { describeTable, queryArrow, countRows } from './duck'
import type { ColumnMeta, SemanticType } from '../types'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const URL_RE = /^(https?:\/\/|www\.)/i
const CURRENCY_RE = /^[$€£¥]\s?-?[\d,]+(\.\d+)?$/
const BOOL_VALUES = new Set(['true', 'false', 'yes', 'no', 't', 'f', '0', '1', 'y', 'n'])

function physicalToBase(type: string): 'number' | 'datetime' | 'boolean' | 'string' {
  const t = type.toUpperCase()
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return 'number'
  if (/DATE|TIME|TIMESTAMP/.test(t)) return 'datetime'
  if (/BOOL/.test(t)) return 'boolean'
  return 'string'
}

function guessSemantic(
  colName: string,
  physicalType: string,
  distinct: number,
  rowCount: number,
  samples: string[],
): SemanticType {
  const base = physicalToBase(physicalType)
  const name = colName.toLowerCase()
  const nonEmpty = samples.filter((s) => s !== null && s !== '')

  if (base === 'boolean') return 'boolean'
  if (base === 'datetime') return 'datetime'

  // Name-based hints.
  if (/(^|_)(id|uuid|guid|key)$/.test(name) || name.endsWith('_id')) {
    // High cardinality + id-ish name -> identifier.
    if (rowCount > 0 && distinct >= rowCount * 0.9) return 'id'
  }

  if (base === 'number') {
    if (/(price|amount|cost|revenue|salary|fee|usd|eur|gbp|balance|total)/.test(name))
      return 'currency'
    // Numeric but low cardinality -> probably a category code.
    if (rowCount > 20 && distinct <= Math.min(20, rowCount * 0.05)) return 'category'
    return 'numeric'
  }

  // string-based value inspection.
  if (nonEmpty.length) {
    if (nonEmpty.every((s) => EMAIL_RE.test(s))) return 'email'
    if (nonEmpty.every((s) => URL_RE.test(s))) return 'url'
    if (nonEmpty.every((s) => CURRENCY_RE.test(s))) return 'currency'
    if (nonEmpty.every((s) => BOOL_VALUES.has(s.toLowerCase()))) return 'boolean'
  }

  if (rowCount > 0 && distinct >= rowCount * 0.9 && /(^|_)(id|code|sku|hash)/.test(name))
    return 'id'

  // Low-cardinality strings -> category; else free text.
  if (rowCount > 0 && distinct <= Math.min(50, rowCount * 0.5)) return 'category'
  return 'text'
}

/** Build the dictionary (column metadata) for a table. */
export async function profileColumns(table: string): Promise<ColumnMeta[]> {
  const cols = await describeTable(table)
  const rowCount = await countRows(table)
  const metas: ColumnMeta[] = []

  for (const col of cols) {
    const q = `SELECT
        COUNT(*) FILTER (WHERE "${col.name}" IS NULL)::DOUBLE AS nulls,
        COUNT(DISTINCT "${col.name}")::DOUBLE AS distinct
      FROM "${table}"`
    let nulls = 0
    let distinct = 0
    try {
      const res = await queryArrow(q)
      const row = res.get(0) as { nulls: number; distinct: number } | null
      if (row) {
        nulls = Number(row.nulls)
        distinct = Number(row.distinct)
      }
    } catch {
      /* leave defaults */
    }

    // Sample non-null values.
    let samples: string[] = []
    try {
      const sres = await queryArrow(
        `SELECT DISTINCT "${col.name}"::VARCHAR AS v FROM "${table}"
         WHERE "${col.name}" IS NOT NULL LIMIT 8`,
      )
      samples = (sres.toArray() as Array<{ v: string }>).map((r) => r.v)
    } catch {
      /* ignore */
    }

    metas.push({
      name: col.name,
      physicalType: col.type,
      semanticType: guessSemantic(col.name, col.type, distinct, rowCount, samples),
      nullPct: rowCount > 0 ? (nulls / rowCount) * 100 : 0,
      distinctCount: distinct,
      sampleValues: samples,
      description: '',
      tags: [],
    })
  }
  return metas
}
