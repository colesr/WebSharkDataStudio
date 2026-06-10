import { useState, useCallback } from 'react'
import { useStore } from '../../state/store'
import { loadCsvText, loadBinaryFile, loadFromUrl, dropTable } from '../../engine/duck'
import { registerCsvSource, registerUrlSource, unregisterSource } from '../../engine/sources'
import { refreshCatalog } from '../../engine/runtime'
import type { TableMeta } from '../../types'

export function Sidebar() {
  return (
    <div className="panel">
      <DataSources />
      <Outline />
    </div>
  )
}

function DataSources() {
  const tables = useStore((s) => s.tables)
  const selectedTable = useStore((s) => s.selectedTable)
  const selectTable = useStore((s) => s.selectTable)
  const addCell = useStore((s) => s.addCell)
  const [drag, setDrag] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        if (/\.csv$/i.test(file.name) || /\.tsv$/i.test(file.name)) {
          const text = await file.text()
          const name = await loadCsvText(file.name, text)
          registerCsvSource(name, text, 'file')
        } else {
          const buf = new Uint8Array(await file.arrayBuffer())
          await loadBinaryFile(file.name, buf)
          // Binary sources aren't embedded as CSV; re-export to CSV for save.
          const { tableToCsv } = await import('../../engine/duck')
          const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_')
          try {
            const csv = await tableToCsv(cleanName)
            registerCsvSource(cleanName, csv, 'file')
          } catch {
            /* leave unembedded */
          }
        }
      }
      await refreshCatalog()
    } catch (err) {
      alert(`Load failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [])

  async function handleUrl() {
    if (!url.trim()) return
    setBusy(true)
    try {
      const name = await loadFromUrl(url.trim())
      registerUrlSource(name, url.trim())
      await refreshCatalog()
      setUrl('')
    } catch (err) {
      alert(`Load failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDrop(name: string) {
    if (!confirm(`Drop table "${name}"?`)) return
    await dropTable(name)
    unregisterSource(name)
    await refreshCatalog()
  }

  const list = Object.values(tables).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
      }}
    >
      <div className="panel-header">
        <span>Data sources {busy && <span className="spinner" style={{ marginLeft: 6 }} />}</span>
        <label className="btn sm" style={{ cursor: 'pointer' }}>
          + Load
          <input
            type="file"
            multiple
            accept=".csv,.tsv,.parquet,.json,.jsonl,.arrow"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </label>
      </div>

      <div className={`dropzone ${drag ? 'drag' : ''}`}>
        Drop CSV / Parquet / JSON here
      </div>
      <div className="url-row">
        <input
          placeholder="https://…/data.csv"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUrl()}
        />
        <button className="btn sm" onClick={handleUrl} disabled={busy}>
          Fetch
        </button>
      </div>

      <div className="sidebar-section">
        {list.length === 0 && <div className="empty">No tables yet.</div>}
        {list.map((t) => (
          <TableItem
            key={t.name}
            table={t}
            selected={selectedTable === t.name}
            onSelect={() => selectTable(t.name)}
            onProfile={() => {
              addCell('profile', undefined, { profileTarget: t.name })
            }}
            onQuery={() => {
              addCell('sql', undefined, {
                code: `SELECT * FROM ${t.name} LIMIT 100;`,
              })
            }}
            onDrop={() => handleDrop(t.name)}
          />
        ))}
      </div>
    </div>
  )
}

function TableItem({
  table,
  selected,
  onSelect,
  onProfile,
  onQuery,
  onDrop,
}: {
  table: TableMeta
  selected: boolean
  onSelect: () => void
  onProfile: () => void
  onQuery: () => void
  onDrop: () => void
}) {
  const badgeClass =
    table.source === 'file' || table.source === 'sample'
      ? 'file'
      : table.source === 'python'
        ? 'python'
        : 'sql'
  const rules = useStore((s) => s.contracts[table.name])
  const status = useStore((s) => s.contractStatus[table.name])
  let contractDot: { color: string; title: string } | null = null
  if (rules && rules.length) {
    if (!status) contractDot = { color: 'var(--text-faint)', title: `${rules.length} rule(s), not checked` }
    else if (status.failed || status.errored)
      contractDot = { color: 'var(--err)', title: `${status.failed + status.errored} rule(s) failing` }
    else contractDot = { color: 'var(--ok)', title: 'all contract rules pass' }
  }
  return (
    <div className={`table-item ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="tname">
        {contractDot && (
          <span
            title={`Contract: ${contractDot.title}`}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: contractDot.color,
              flexShrink: 0,
            }}
          />
        )}
        <span>{table.name}</span>
        <span className={`badge ${badgeClass}`}>{table.source}</span>
      </div>
      <div className="tmeta">
        {table.rowCount.toLocaleString()} rows · {table.columns.length} cols
      </div>
      <div className="actions">
        <button
          className="btn sm ghost"
          onClick={(e) => {
            e.stopPropagation()
            onQuery()
          }}
        >
          Query
        </button>
        <button
          className="btn sm ghost"
          onClick={(e) => {
            e.stopPropagation()
            onProfile()
          }}
        >
          Profile
        </button>
        <button
          className="btn sm ghost"
          onClick={(e) => {
            e.stopPropagation()
            onDrop()
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function Outline() {
  const cells = useStore((s) => s.cells)
  const selectCell = useStore((s) => s.selectCell)
  const icon = (t: string) =>
    t === 'sql'
      ? '⌗'
      : t === 'python'
        ? '🐍'
        : t === 'markdown'
          ? '¶'
          : t === 'chart'
            ? '📊'
            : t === 'stress'
              ? '⚡'
              : t === 'model'
                ? '🧪'
                : '🔍'

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)' }}>
      <div className="panel-header">Outline</div>
      {cells.map((c) => {
        const label =
          c.type === 'markdown'
            ? (c.code.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') || 'Markdown')
            : c.name || c.profileTarget || c.chart?.table || `${c.type} cell`
        return (
          <div
            key={c.id}
            className="outline-item"
            onClick={() => {
              selectCell(c.id)
              document.getElementById(`cell-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          >
            <span>{icon(c.type)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
