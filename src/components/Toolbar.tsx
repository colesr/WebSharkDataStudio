import { useState } from 'react'
import { useStore } from '../state/store'
import { runAll, runAllFresh } from '../engine/runtime'
import { saveProjectToFile, openProjectFromFile, clearAutosave } from '../engine/persistence'
import { ShipStatus } from './ShipStatus'

export function Toolbar() {
  const project = useStore((s) => s.project)
  const setProject = useStore((s) => s.setProject)
  const reportMode = useStore((s) => s.reportMode)
  const setReportMode = useStore((s) => s.setReportMode)
  const reset = useStore((s) => s.reset)
  const dirty = useStore((s) => s.dirty)
  const [running, setRunning] = useState<'all' | 'fresh' | null>(null)

  async function handleRunAll() {
    setRunning('all')
    try {
      await runAll()
    } finally {
      setRunning(null)
    }
  }
  async function handleRunFresh() {
    setRunning('fresh')
    try {
      await runAllFresh()
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="logo">🦈</span>
        <span>
          WebShark <span className="sub">Data Studio</span>
        </span>
      </div>

      <input
        className="project-name"
        value={project.name}
        onChange={(e) => setProject({ name: e.target.value })}
        title="Project name"
      />
      {dirty && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>● unsaved</span>}

      <ShipStatus />

      <div className="spacer" />

      <label
        title="Random seed pinned into Python (numpy/random) for reproducible runs"
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-dim)' }}
      >
        seed
        <input
          type="number"
          value={project.seed}
          onChange={(e) => setProject({ seed: Number(e.target.value) || 0 })}
          style={{
            width: 64,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 5,
            padding: '3px 6px',
            fontFamily: 'var(--mono)',
          }}
        />
      </label>

      <button className="btn sm" onClick={handleRunAll} disabled={!!running}>
        {running === 'all' ? <span className="spinner" /> : '▷'} Run all
      </button>
      <button
        className="btn sm"
        onClick={handleRunFresh}
        disabled={!!running}
        title="Reset engine + Python, reload sources, and re-run top-to-bottom for a clean reproduction"
      >
        {running === 'fresh' ? <span className="spinner" /> : '↻'} Run fresh
      </button>

      <span style={{ width: 1, height: 22, background: 'var(--border)' }} />

      <button className="btn sm" onClick={() => openProjectFromFile()}>
        Open
      </button>
      <button className="btn sm" onClick={() => saveProjectToFile()}>
        Save
      </button>
      <button
        className="btn sm"
        onClick={() => setReportMode(!reportMode)}
        title="Toggle a clean reading view that hides code"
      >
        {reportMode ? '✎ Edit' : '▤ Report'}
      </button>
      <button
        className="btn sm ghost"
        title="New project (clears the current session)"
        onClick={() => {
          if (confirm('Start a new project? Unsaved changes will be lost.')) {
            clearAutosave()
            reset()
            location.reload()
          }
        }}
      >
        New
      </button>
    </div>
  )
}
