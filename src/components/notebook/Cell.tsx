import { useState } from 'react'
import { useStore } from '../../state/store'
import { runCell, markStaleDownstream } from '../../engine/runtime'
import type { Cell as CellT } from '../../types'
import { Editor } from '../Editor'
import { Markdown } from './Markdown'
import { OutputTable } from './OutputTable'
import { ChartCell } from './ChartCell'
import { ProfileCell } from './ProfileCell'
import { StressCell } from './StressCell'

const TYPE_LABEL: Record<string, string> = {
  sql: 'SQL',
  python: 'Python',
  markdown: 'Markdown',
  chart: 'Chart',
  profile: 'Profile',
  stress: 'Stress-test',
}

export function CellView({ cell }: { cell: CellT }) {
  const selectedCellId = useStore((s) => s.selectedCellId)
  const selectCell = useStore((s) => s.selectCell)
  const updateCell = useStore((s) => s.updateCell)
  const removeCell = useStore((s) => s.removeCell)
  const moveCell = useStore((s) => s.moveCell)
  const setCellStatus = useStore((s) => s.setCellStatus)
  const [mdEditing, setMdEditing] = useState(cell.code.trim() === '')

  const selected = selectedCellId === cell.id
  const lang = cell.type === 'sql' ? 'sql' : cell.type === 'python' ? 'python' : 'markdown'
  const editable = cell.type === 'sql' || cell.type === 'python' || cell.type === 'markdown'

  function onChange(code: string) {
    updateCell(cell.id, { code })
    // Editing invalidates this cell + everything downstream.
    if (cell.status === 'ok') setCellStatus(cell.id, 'stale')
    markStaleDownstream(cell.id)
  }

  function run() {
    if (cell.type === 'markdown') {
      setMdEditing(false)
      setCellStatus(cell.id, 'ok')
      return
    }
    runCell(cell.id)
  }

  return (
    <div
      id={`cell-${cell.id}`}
      className={`cell ${selected ? 'selected' : ''}`}
      onClick={() => selectCell(cell.id)}
    >
      <div className="cell-bar">
        <span className="cell-type">{TYPE_LABEL[cell.type]}</span>
        {(cell.type === 'sql' || cell.type === 'python') && (
          <input
            className="cell-name-input"
            placeholder={cell.type === 'sql' ? 'output table name…' : 'ws.publish name…'}
            value={cell.name || ''}
            onChange={(e) => {
              updateCell(cell.id, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') || undefined })
              if (cell.status === 'ok') setCellStatus(cell.id, 'stale')
            }}
            title="Naming a cell publishes its result as a reusable table"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <div className="spacer" />
        {cell.output?.durationMs != null && (
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {cell.output.durationMs < 1000
              ? `${Math.round(cell.output.durationMs)}ms`
              : `${(cell.output.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        <span className={`status-dot ${cell.status}`} title={cell.status} />
        {editable && cell.type !== 'markdown' && (
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); run() }}>
            {cell.status === 'running' ? <span className="spinner" /> : '▷'}
          </button>
        )}
        {cell.type === 'markdown' && (
          <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setMdEditing((v) => !v) }}>
            {mdEditing ? 'Done' : 'Edit'}
          </button>
        )}
        <button className="btn sm ghost" title="Move up" onClick={(e) => { e.stopPropagation(); moveCell(cell.id, -1) }}>
          ↑
        </button>
        <button className="btn sm ghost" title="Move down" onClick={(e) => { e.stopPropagation(); moveCell(cell.id, 1) }}>
          ↓
        </button>
        <button className="btn sm ghost" title="Delete" onClick={(e) => { e.stopPropagation(); removeCell(cell.id) }}>
          🗑
        </button>
      </div>

      {/* Body */}
      {cell.type === 'markdown' ? (
        mdEditing ? (
          <Editor value={cell.code} lang="markdown" onChange={onChange} onRun={run} />
        ) : (
          <Markdown source={cell.code} />
        )
      ) : cell.type === 'chart' ? (
        <ChartCell cell={cell} />
      ) : cell.type === 'profile' ? (
        <ProfileCell cell={cell} />
      ) : cell.type === 'stress' ? (
        <StressCell cell={cell} />
      ) : (
        <Editor value={cell.code} lang={lang} onChange={onChange} onRun={run} />
      )}

      {/* Output (sql / python) */}
      {(cell.type === 'sql' || cell.type === 'python') && cell.output && (
        <div className="cell-output">
          {cell.output.error && <div className="out-error">{cell.output.error}</div>}
          {cell.output.text && <div className="out-text">{cell.output.text}</div>}
          {cell.output.image && (
            <img src={cell.output.image} alt="figure" style={{ maxWidth: '100%', padding: 10 }} />
          )}
          {cell.output.table && <OutputTable table={cell.output.table} />}
        </div>
      )}
    </div>
  )
}
