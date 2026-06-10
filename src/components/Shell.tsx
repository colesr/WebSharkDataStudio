import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Toolbar } from './Toolbar'
import { Sidebar } from './sidebar/Sidebar'
import { Notebook } from './notebook/Notebook'
import { Inspector } from './inspector/Inspector'
import { PythonToast } from './PythonToast'

export function Shell() {
  return (
    <div className="app">
      <Toolbar />
      <PanelGroup direction="horizontal" className="panes" autoSaveId="wsds-layout">
        <Panel defaultSize={20} minSize={14} maxSize={34}>
          <Sidebar />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={54} minSize={30}>
          <div className="panel" style={{ background: 'var(--bg)' }}>
            <Notebook />
          </div>
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={26} minSize={16} maxSize={42}>
          <Inspector />
        </Panel>
      </PanelGroup>
      <PythonToast />
    </div>
  )
}
