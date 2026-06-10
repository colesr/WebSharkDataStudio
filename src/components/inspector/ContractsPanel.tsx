import { useState } from 'react'
import { useStore, newId } from '../../state/store'
import { evaluateContract, summarize, describeRule } from '../../engine/contracts'
import type { ContractRule, ContractRuleResult, ContractRuleType } from '../../types'

const RULE_TYPES: { value: ContractRuleType; label: string }[] = [
  { value: 'not_null', label: 'Not null' },
  { value: 'unique', label: 'Unique' },
  { value: 'range', label: 'In range' },
  { value: 'allowed_values', label: 'Allowed values' },
  { value: 'regex', label: 'Matches regex' },
  { value: 'row_count', label: 'Row count' },
]

export function ContractsPanel({ table }: { table: string }) {
  const rules = useStore((s) => s.contracts[table]) || []
  const setContract = useStore((s) => s.setContract)
  const setContractStatus = useStore((s) => s.setContractStatus)
  const dict = useStore((s) => s.dictionary[table]) || []
  const columns = dict.map((c) => c.name)
  const [results, setResults] = useState<Record<string, ContractRuleResult>>({})
  const [checking, setChecking] = useState(false)

  function addRule() {
    const rule: ContractRule = {
      id: newId('r'),
      type: 'not_null',
      column: columns[0],
    }
    setContract(table, [...rules, rule])
  }
  function updateRule(id: string, patch: Partial<ContractRule>) {
    setContract(table, rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function removeRule(id: string) {
    setContract(table, rules.filter((r) => r.id !== id))
    setResults((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function check() {
    setChecking(true)
    try {
      const res = await evaluateContract(table, rules)
      const byId: Record<string, ContractRuleResult> = {}
      for (const r of res) byId[r.rule.id] = r
      setResults(byId)
      setContractStatus(table, summarize(res))
    } finally {
      setChecking(false)
    }
  }

  const needsColumn = (t: ContractRuleType) => t !== 'row_count'

  return (
    <div style={{ overflowY: 'auto' }}>
      <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-faint)' }}>
        Define what “production-ready” means for <b style={{ color: 'var(--text)' }}>{table}</b>. Rules
        run as in-engine SQL and report exactly how many rows violate them.
      </div>

      {rules.length === 0 && <div className="empty">No rules yet. Add one below.</div>}

      {rules.map((rule) => {
        const res = results[rule.id]
        return (
          <div className="dict-col" key={rule.id}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="sem-pill"
                value={rule.type}
                onChange={(e) => updateRule(rule.id, { type: e.target.value as ContractRuleType })}
              >
                {RULE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {needsColumn(rule.type) && (
                <select
                  className="cell-name-input"
                  style={{ width: 'auto' }}
                  value={rule.column || ''}
                  onChange={(e) => updateRule(rule.id, { column: e.target.value })}
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn sm ghost" onClick={() => removeRule(rule.id)}>
                ✕
              </button>
            </div>

            {/* parameter inputs */}
            {(rule.type === 'range' || rule.type === 'row_count') && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  className="dict-desc"
                  style={{ marginTop: 0 }}
                  type="number"
                  placeholder="min"
                  value={rule.min ?? ''}
                  onChange={(e) => updateRule(rule.id, { min: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
                <input
                  className="dict-desc"
                  style={{ marginTop: 0 }}
                  type="number"
                  placeholder="max"
                  value={rule.max ?? ''}
                  onChange={(e) => updateRule(rule.id, { max: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
            )}
            {rule.type === 'allowed_values' && (
              <input
                className="dict-desc"
                placeholder="comma,separated,values"
                value={(rule.values || []).join(',')}
                onChange={(e) =>
                  updateRule(rule.id, {
                    values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                  })
                }
              />
            )}
            {rule.type === 'regex' && (
              <input
                className="dict-desc"
                placeholder="^[A-Z]{2}-\\d+$"
                value={rule.pattern || ''}
                onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
              />
            )}

            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              {describeRule(rule)}
            </div>

            {res && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: res.failingRows < 0 ? 'var(--err)' : res.passed ? 'var(--ok)' : 'var(--err)',
                }}
              >
                {res.failingRows < 0
                  ? `⚠ error: ${res.detail}`
                  : res.passed
                    ? `✓ pass${res.detail ? ` (${res.detail})` : ''}`
                    : `✕ ${res.failingRows.toLocaleString()} / ${res.total.toLocaleString()} rows violate`}
              </div>
            )}
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 6, padding: '10px 12px' }}>
        <button className="btn sm" onClick={addRule} disabled={!columns.length}>
          + Add rule
        </button>
        <button className="btn sm primary" onClick={check} disabled={!rules.length || checking}>
          {checking ? <span className="spinner" /> : '✓'} Check contract
        </button>
      </div>
    </div>
  )
}
