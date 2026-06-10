// ---------------------------------------------------------------------------
// Stress-test harness — the heart of the "sandbox": isolate a transform and
// hammer it with adversarial, degenerate, and scaled-up inputs to find what
// breaks *before* production.
//
// This module is pure (no runtime/store imports) so it can't create import
// cycles: it only builds the SQL for each attack. The orchestration that swaps
// a transform cell's input, re-runs it, and grades the outcome lives in
// engine/runtime.ts.
// ---------------------------------------------------------------------------

import type { ColumnInfo } from './duck'

export interface StressResult {
  attack: string
  label: string
  status: 'ok' | 'error' | 'warning'
  inputRows: number
  outputRows?: number
  schemaChanged?: boolean
  contractFailures?: number
  durationMs: number
  message?: string
}

function q(name: string) {
  return `"${name.replace(/"/g, '""')}"`
}

const isNumeric = (t: string) => /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/i.test(t)
const isString = (t: string) => /VARCHAR|CHAR|TEXT|STRING/i.test(t)

/**
 * Build column expressions for a value-mutating attack. `transform` returns a
 * SQL expression for a column, or null to pass it through unchanged.
 */
function exprs(
  cols: ColumnInfo[],
  transform: (col: ColumnInfo) => string | null,
): string {
  return cols
    .map((c) => {
      const e = transform(c)
      return `${e ?? q(c.name)} AS ${q(c.name)}`
    })
    .join(', ')
}

export interface Attack {
  key: string
  label: string
  description: string
  /** Returns the SELECT body that produces the mutated input from `bak`. */
  build: (bak: string, cols: ColumnInfo[]) => string
  /** True if this attack deliberately changes row cardinality. */
  changesCardinality?: boolean
}

export const STRESS_ATTACKS: Attack[] = [
  {
    key: 'baseline',
    label: 'Baseline',
    description: 'The real input, unchanged — the control case.',
    build: (bak) => `SELECT * FROM ${q(bak)}`,
  },
  {
    key: 'empty',
    label: 'Empty input',
    description: 'Zero rows — does the transform handle no data?',
    changesCardinality: true,
    build: (bak) => `SELECT * FROM ${q(bak)} WHERE 1 = 0`,
  },
  {
    key: 'single_row',
    label: 'Single row',
    description: 'Exactly one row — breaks anything assuming multiple rows.',
    changesCardinality: true,
    build: (bak) => `SELECT * FROM ${q(bak)} LIMIT 1`,
  },
  {
    key: 'duplicates',
    label: 'Duplicate rows',
    description: 'Every row doubled — exposes missing de-duplication.',
    changesCardinality: true,
    build: (bak) => `SELECT * FROM ${q(bak)} UNION ALL SELECT * FROM ${q(bak)}`,
  },
  {
    key: 'volume_x25',
    label: 'Volume ×25',
    description: 'Scaled 25× — surfaces performance cliffs & overflow.',
    changesCardinality: true,
    build: (bak) => `SELECT b.* FROM ${q(bak)} b, range(25)`,
  },
  {
    key: 'null_bomb',
    label: 'Null bomb',
    description: 'Half of every column set to NULL — tests null handling.',
    build: (bak, cols) =>
      `SELECT ${exprs(cols, (c) => `CASE WHEN (rowid % 2) = 0 THEN ${q(c.name)} ELSE NULL END`)} FROM ${q(bak)}`,
  },
  {
    key: 'numeric_extremes',
    label: 'Numeric extremes',
    description: 'Inject huge / negative / zero values into numeric columns.',
    build: (bak, cols) =>
      `SELECT ${exprs(cols, (c) =>
        isNumeric(c.type)
          ? `CASE rowid % 4 WHEN 0 THEN 1e15 WHEN 1 THEN -1e15 WHEN 2 THEN 0 ELSE ${q(c.name)} END`
          : null,
      )} FROM ${q(bak)}`,
  },
  {
    key: 'blank_strings',
    label: 'Blank strings',
    description: 'Empty-string half of every text column (vs. NULL).',
    build: (bak, cols) =>
      `SELECT ${exprs(cols, (c) =>
        isString(c.type) ? `CASE WHEN (rowid % 2) = 0 THEN '' ELSE ${q(c.name)} END` : null,
      )} FROM ${q(bak)}`,
  },
  {
    key: 'whitespace',
    label: 'Whitespace padding',
    description: 'Pad text values with spaces — catches missing trims.',
    build: (bak, cols) =>
      `SELECT ${exprs(cols, (c) =>
        isString(c.type) ? `'  ' || ${q(c.name)} || '  '` : null,
      )} FROM ${q(bak)}`,
  },
  {
    key: 'mixed_case',
    label: 'Mixed case',
    description: 'Flip case of text — exposes case-sensitive joins/group-bys.',
    build: (bak, cols) =>
      `SELECT ${exprs(cols, (c) =>
        isString(c.type)
          ? `CASE WHEN (rowid % 2) = 0 THEN upper(${q(c.name)}) ELSE lower(${q(c.name)}) END`
          : null,
      )} FROM ${q(bak)}`,
  },
  {
    key: 'unicode',
    label: 'Unicode & emoji',
    description: 'Append unicode/emoji to text — encoding stress.',
    build: (bak, cols) =>
      `SELECT ${exprs(cols, (c) =>
        isString(c.type) ? `${q(c.name)} || ' 🦈—café—💥'` : null,
      )} FROM ${q(bak)}`,
  },
]
