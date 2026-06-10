import { useState, type DragEvent } from 'react'
import { useStore } from '../../state/store'
import { runCell, markStaleDownstream } from '../../engine/runtime'
import type { Cell as CellT } from '../../types'
import { Editor } from '../Editor'
import { Markdown } from './Markdown'
import { OutputTable } from './OutputTable'
import { ChartCell } from './ChartCell'
import { ProfileCell } from './ProfileCell'
import { StressCell } from './StressCell'
import { ModelCell } from './ModelCell'
import { ExperimentsCell } from './ExperimentsCell'

const TYPE_LABEL: Record<string, string> = {
  sql: 'SQL',
  python: 'Python',
  markdown: 'Markdown',
  chart: 'Chart',
  profile: 'Profile',
  stress: 'Stress-test',
  model: 'Model',
  experiments: 'Experiments',
}

const DND_TYPE = 'text/wsds-cell'

export function CellView({ cell }: { cell: CellT }) {
  const selectedCellId = useStore((s) => s.selectedCellId)
  const selectCell = useStore((s) => s.selectCell)
  const updateCell = useStore((s) => s.updateCell)
  const removeCell = useStore((s) => s.removeCell)
  const moveCellTo = useStore((s) => s.moveCellTo)
  const setCellStatus = useStore((s) => s.setCellStatus)
  const [mdEditing, setMdEditing] = useState(cell.code.trim() === '')
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null)
  const [dragging, setDragging] = useState(false)

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

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(DND_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    setDropPos(e.clientY > rect.top + rect.height / 2 ? 'after' : 'before')
  }
  function onDragLeave(e: DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropPos(null)
  }
  function onDrop(e: DragEvent) {
    if (!e.dataTransfer.types.includes(DND_TYPE)) return
    e.preventDefault()
    const draggedId = e.dataTransfer.getData(DND_TYPE)
    setDropPos(null)
    if (!draggedId || draggedId === cell.id) return
    // Compute the drop position from the event (not React state, which can be
    // stale if drop fires in the same tick as the last dragover).
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    const cells = useStore.getState().cells
    const fromIdx = cells.findIndex((c) => c.id === draggedId)
    const overIdx = cells.findIndex((c) => c.id === cell.id)
    if (fromIdx < 0 || overIdx < 0) return
    let target = after ? overIdx + 1 : overIdx
    if (fromIdx < target) target -= 1
    moveCellTo(draggedId, target)
  }

  const cls = [
    'cell',
    selected ? 'selected' : '',
    cell.status === 'running' ? 'running' : '',
    dragging ? 'dragging' : '',
    dropPos ? `drop-${dropPos}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      id={`cell-${cell.id}`}
      className={cls}
      onClick={() => selectCell(cell.id)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="cell-bar">
        <span
          className="cell-grip"
          draggable
          title="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_TYPE, cell.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragging(true)
          }}
          onDragEnd={() => {
            setDragging(false)
            setDropPos(null)
          }}
        >
          ⠿
        </span>
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
      ) : cell.type === 'model' ? (
        <ModelCell cell={cell} />
      ) : cell.type === 'experiments' ? (
        <ExperimentsCell />
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
