// ---------------------------------------------------------------------------
// Project persistence: autosave to localStorage + .wsds.json save/open.
//
// The project file is the whole reproducible unit — cells, the data dictionary,
// chart specs, the random seed, and the source datasets (embedded as CSV, or
// referenced by URL). Re-opening it and running "Run all (fresh)" reproduces
// the analysis deterministically.
// ---------------------------------------------------------------------------

import { useStore } from '../state/store'
import type { ProjectFile } from '../types'
import { listSources, setSources } from './sources'
import { reloadSources } from './sources'
import { refreshCatalog } from './runtime'

const STORAGE_KEY = 'wsds.autosave.v1'
const PROJECT_VERSION = 1

export function buildProjectFile(): ProjectFile {
  const s = useStore.getState()
  return {
    app: 'webshark-data-studio',
    version: PROJECT_VERSION,
    meta: s.project,
    cells: s.cells.map((c) => ({ ...c, status: 'idle', output: undefined })),
    dictionary: s.dictionary,
    contracts: s.contracts,
    datasets: listSources(),
  }
}

export function serializeProject(): string {
  return JSON.stringify(buildProjectFile(), null, 2)
}

/** Apply a parsed project file to the store + engine (reloads source data). */
export async function applyProjectFile(file: ProjectFile): Promise<void> {
  if (file.app !== 'webshark-data-studio') {
    throw new Error('Not a WebShark project file')
  }
  setSources(file.datasets || [])
  useStore.getState().loadProject({
    cells: file.cells,
    dictionary: file.dictionary || {},
    contracts: file.contracts || {},
    project: file.meta,
  })
  // Reset engine state and reload the embedded source datasets.
  const { resetEngine } = await import('./duck')
  await resetEngine()
  await reloadSources()
  await refreshCatalog()
}

// ---- localStorage autosave ------------------------------------------------

export function autosave(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject())
  } catch (err) {
    console.warn('Autosave failed', err)
  }
}

export function hasAutosave(): boolean {
  return !!localStorage.getItem(STORAGE_KEY)
}

export async function restoreAutosave(): Promise<boolean> {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return false
  try {
    const file = JSON.parse(raw) as ProjectFile
    await applyProjectFile(file)
    return true
  } catch (err) {
    console.warn('Failed to restore autosave', err)
    return false
  }
}

export function clearAutosave(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// ---- File save / open -----------------------------------------------------

const FS_TYPES = [
  { description: 'WebShark project', accept: { 'application/json': ['.wsds.json', '.json'] } },
]

export async function saveProjectToFile(): Promise<void> {
  const text = serializeProject()
  const name = `${useStore.getState().project.name.replace(/[^a-z0-9]+/gi, '_')}.wsds.json`
  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<any>
  }
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name, types: FS_TYPES })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      useStore.getState().markClean()
      return
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // fall through to download
    }
  }
  downloadText(name, text)
  useStore.getState().markClean()
}

export async function openProjectFromFile(): Promise<void> {
  const w = window as unknown as {
    showOpenFilePicker?: (opts: unknown) => Promise<any[]>
  }
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: FS_TYPES, multiple: false })
      const file = await handle.getFile()
      const text = await file.text()
      await applyProjectFile(JSON.parse(text))
      return
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
    }
  }
  // Fallback: hidden file input.
  await openViaInput()
}

function openViaInput(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.wsds.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve()
      const text = await file.text()
      try {
        await applyProjectFile(JSON.parse(text))
      } catch (err) {
        alert(`Could not open project: ${(err as Error).message}`)
      }
      resolve()
    }
    input.click()
  })
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
