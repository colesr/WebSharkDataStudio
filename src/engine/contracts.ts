// ---------------------------------------------------------------------------
// Data contracts — the "is this table production-ready?" guardrail.
//
// A contract is a list of rules evaluated as in-engine SQL against a DuckDB
// table. Each rule returns a pass/fail plus the count of violating rows so you
// can debug exactly what's wrong, in real time, before anything ships.
// ---------------------------------------------------------------------------

import { queryArrow, countRows } from './duck'
import type { ContractRule, ContractRuleResult, ContractStatus } from '../types'

async function scalarCount(sql: string): Promise<number> {
  const res = await queryArrow(sql)
  const row = res.get(0)
  if (!row) return 0
  const v = Object.values(row.toJSON())[0]
  return Number(v) || 0
}

function q(name: string) {
  return `"${name.replace(/"/g, '""')}"`
}
function lit(v: string) {
  return `'${v.replace(/'/g, "''")}'`
}

export function describeRule(rule: ContractRule): string {
  switch (rule.type) {
    case 'not_null':
      return `${rule.column} is never null`
    case 'unique':
      return `${rule.column} is unique`
    case 'range':
      return `${rule.column} ∈ [${rule.min ?? '−∞'}, ${rule.max ?? '∞'}]`
    case 'allowed_values':
      return `${rule.column} ∈ {${(rule.values || []).join(', ')}}`
    case 'regex':
      return `${rule.column} matches /${rule.pattern}/`
    case 'row_count':
      return `row count ∈ [${rule.min ?? 0}, ${rule.max ?? '∞'}]`
  }
}

export async function evaluateRule(
  table: string,
  rule: ContractRule,
): Promise<ContractRuleResult> {
  const total = await countRows(table)
  try {
    if (rule.type === 'row_count') {
      let bad = false
      if (rule.min != null && total < rule.min) bad = true
      if (rule.max != null && total > rule.max) bad = true
      return { rule, passed: !bad, failingRows: bad ? 1 : 0, total, detail: `${total} rows` }
    }

    const col = rule.column ? q(rule.column) : null
    let failing = 0

    switch (rule.type) {
      case 'not_null':
        failing = await scalarCount(`SELECT COUNT(*) FROM ${q(table)} WHERE ${col} IS NULL`)
        break
      case 'unique':
        failing = await scalarCount(
          `SELECT COALESCE(SUM(c), 0) FROM (
             SELECT COUNT(*) AS c FROM ${q(table)}
             WHERE ${col} IS NOT NULL GROUP BY ${col} HAVING COUNT(*) > 1)`,
        )
        break
      case 'range': {
        const conds: string[] = []
        if (rule.min != null) conds.push(`${col} < ${rule.min}`)
        if (rule.max != null) conds.push(`${col} > ${rule.max}`)
        const where = conds.length ? conds.join(' OR ') : '1=0'
        failing = await scalarCount(
          `SELECT COUNT(*) FROM ${q(table)} WHERE ${col} IS NOT NULL AND (${where})`,
        )
        break
      }
      case 'allowed_values': {
        const list = (rule.values || []).map(lit).join(', ') || `''`
        failing = await scalarCount(
          `SELECT COUNT(*) FROM ${q(table)}
           WHERE ${col} IS NOT NULL AND ${col}::VARCHAR NOT IN (${list})`,
        )
        break
      }
      case 'regex':
        failing = await scalarCount(
          `SELECT COUNT(*) FROM ${q(table)}
           WHERE ${col} IS NOT NULL AND NOT regexp_matches(${col}::VARCHAR, ${lit(rule.pattern || '')})`,
        )
        break
    }
    return { rule, passed: failing === 0, failingRows: failing, total }
  } catch (err) {
    return { rule, passed: false, failingRows: -1, total, detail: String((err as Error).message) }
  }
}

export async function evaluateContract(
  table: string,
  rules: ContractRule[],
): Promise<ContractRuleResult[]> {
  const out: ContractRuleResult[] = []
  for (const r of rules) out.push(await evaluateRule(table, r))
  return out
}

export function summarize(results: ContractRuleResult[]): ContractStatus {
  let passed = 0
  let failed = 0
  let errored = 0
  for (const r of results) {
    if (r.failingRows < 0) errored++
    else if (r.passed) passed++
    else failed++
  }
  return { passed, failed, errored }
}
