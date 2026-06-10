import { useEffect, useRef, useState } from 'react'
import { useStore } from './state/store'
import { Shell } from './components/Shell'
import { ReportView } from './components/report/ReportView'
import { loadCsvText } from './engine/duck'
import { registerCsvSource, listSources } from './engine/sources'
import { refreshCatalog } from './engine/runtime'
import { restoreAutosave, autosave, hasAutosave } from './engine/persistence'
import { SAMPLE_DATASETS } from './data/sampleData'

type BootState = 'booting' | 'ready' | 'error'

export function App() {
  const [boot, setBoot] = useState<BootState>('booting')
  const [bootMsg, setBootMsg] = useState('Starting the data engine…')
  const reportMode = useStore((s) => s.reportMode)
  const cells = useStore((s) => s.cells)
  const dictionary = useStore((s) => s.dictionary)
  const project = useStore((s) => s.project)
  const didBoot = useRef(false)

  useEffect(() => {
    if (didBoot.current) return
    didBoot.current = true
    ;(async () => {
      try {
        setBootMsg('Initializing DuckDB (WebAssembly)…')
        // Restore a saved session if present; otherwise load sample data.
        if (hasAutosave()) {
          setBootMsg('Restoring your last session…')
          const ok = await restoreAutosave()
          if (!ok) await loadSamples(setBootMsg)
        } else {
          await loadSamples(setBootMsg)
        }
        await refreshCatalog()
        setBoot('ready')
      } catch (err) {
        console.error(err)
        setBootMsg(String((err as Error).message || err))
        setBoot('error')
      }
    })()
  }, [])

  // Debounced autosave whenever the project changes.
  useEffect(() => {
    if (boot !== 'ready') return
    const t = setTimeout(() => autosave(), 600)
    return () => clearTimeout(t)
  }, [cells, dictionary, project, boot])

  if (boot === 'booting') {
    return (
      <div className="boot-screen">
        <div className="logo">🦈</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>
          WebShark Data Studio
        </div>
        <div className="spinner" />
        <div>{bootMsg}</div>
      </div>
    )
  }

  if (boot === 'error') {
    return (
      <div className="boot-screen">
        <div className="logo">🦈</div>
        <div style={{ color: 'var(--err)' }}>Failed to start: {bootMsg}</div>
        <div style={{ fontSize: 12 }}>
          Try reloading. WebShark needs WebAssembly support in your browser.
        </div>
      </div>
    )
  }

  return reportMode ? <ReportView /> : <Shell />
}

async function loadSamples(setMsg: (s: string) => void) {
  // Only load samples that aren't already present (avoids duplicate on reload).
  const existing = new Set(listSources().map((s) => s.name))
  for (const ds of SAMPLE_DATASETS) {
    if (existing.has(ds.name)) continue
    setMsg(`Loading sample dataset “${ds.name}”…`)
    await loadCsvText(ds.name, ds.csv)
    registerCsvSource(ds.name, ds.csv, 'sample')
  }
}
