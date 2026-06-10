import { useStore } from '../../state/store'
import { Markdown } from '../notebook/Markdown'
import { OutputTable } from '../notebook/OutputTable'
import { VegaView } from '../notebook/VegaView'
import { ProfileView } from '../ProfileView'
import type { TableProfile } from '../../engine/profile'
import { exportReportHtml } from './exportHtml'

export function ReportView() {
  const cells = useStore((s) => s.cells)
  const project = useStore((s) => s.project)
  const setReportMode = useStore((s) => s.setReportMode)

  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand">
          <span className="logo">🦈</span>
          <span>
            WebShark <span className="sub">Report</span>
          </span>
        </div>
        <div className="spacer" />
        <button className="btn sm" onClick={() => exportReportHtml()}>
          ⬇ Export HTML
        </button>
        <button className="btn sm primary" onClick={() => setReportMode(false)}>
          ✎ Back to editor
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
        <div className="report">
          <h1 style={{ borderBottom: '1px solid var(--border-soft)', paddingBottom: 10 }}>
            {project.name}
          </h1>
          {project.description && <p style={{ color: 'var(--text-dim)' }}>{project.description}</p>}

          {cells.map((cell) => {
            if (cell.type === 'markdown') {
              return (
                <div className="report-block" key={cell.id}>
                  <Markdown source={cell.code} />
                </div>
              )
            }
            if (cell.type === 'chart' && cell.output?.vegaSpec) {
              return (
                <div className="report-block" key={cell.id}>
                  <VegaView spec={cell.output.vegaSpec} />
                </div>
              )
            }
            if (cell.type === 'profile' && cell.output?.profile) {
              return (
                <div className="report-block" key={cell.id}>
                  <ProfileView profile={cell.output.profile as TableProfile} />
                </div>
              )
            }
            if ((cell.type === 'sql' || cell.type === 'python') && cell.output?.table) {
              return (
                <div className="report-block" key={cell.id}>
                  {cell.name && <div className="report-caption">{cell.name}</div>}
                  <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'auto', maxHeight: 400 }}>
                    <OutputTable table={cell.output.table} />
                  </div>
                </div>
              )
            }
            if ((cell.type === 'sql' || cell.type === 'python') && cell.output?.image) {
              return (
                <div className="report-block" key={cell.id}>
                  <img src={cell.output.image} alt="figure" style={{ maxWidth: '100%' }} />
                </div>
              )
            }
            return null
          })}

          <div style={{ marginTop: 40, color: 'var(--text-faint)', fontSize: 11 }}>
            Generated with 🦈 WebShark Data Studio · seed {project.seed}
          </div>
        </div>
      </div>
    </div>
  )
}
