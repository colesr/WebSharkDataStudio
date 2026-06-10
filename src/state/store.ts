// ---------------------------------------------------------------------------
// Global application state (Zustand).
//
// Holds the notebook (cells), the catalog of DuckDB tables + their data
// dictionary, project metadata, and UI flags. Engine orchestration lives in
// engine/runtime.ts, which reads/writes this store via getState/setState.
// ---------------------------------------------------------------------------

import { create } from 'zustand'
import type {
  Cell,
  CellOutput,
  CellStatus,
  CellType,
  ColumnMeta,
  ProjectMeta,
  TableMeta,
} from '../types'

let idCounter = 0
export function newId(prefix = 'c'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

export type InspectorTab = 'dictionary' | 'profile'

interface AppState {
  cells: Cell[]
  tables: Record<string, TableMeta>
  dictionary: Record<string, ColumnMeta[]>
  project: ProjectMeta
  selectedCellId: string | null
  selectedTable: string | null
  inspectorTab: InspectorTab
  reportMode: boolean
  pythonStage: string | null // null = not loading, string = status text
  dirty: boolean

  // cell ops
  addCell: (type: CellType, afterId?: string, init?: Partial<Cell>) => string
  updateCell: (id: string, patch: Partial<Cell>) => void
  setCellStatus: (id: string, status: CellStatus) => void
  setCellOutput: (id: string, output: CellOutput | undefined) => void
  removeCell: (id: string) => void
  moveCell: (id: string, dir: -1 | 1) => void
  selectCell: (id: string | null) => void

  // catalog
  setTables: (tables: Record<string, TableMeta>) => void
  setDictionary: (table: string, cols: ColumnMeta[]) => void
  updateColumnMeta: (table: string, col: string, patch: Partial<ColumnMeta>) => void
  selectTable: (name: string | null) => void
  setInspectorTab: (tab: InspectorTab) => void

  // project / ui
  setProject: (patch: Partial<ProjectMeta>) => void
  setReportMode: (on: boolean) => void
  setPythonStage: (stage: string | null) => void
  markClean: () => void
  loadProject: (data: {
    cells: Cell[]
    dictionary: Record<string, ColumnMeta[]>
    project: ProjectMeta
  }) => void
  reset: () => void
}

function defaultProject(): ProjectMeta {
  return {
    name: 'Untitled analysis',
    seed: 42,
    createdAt: new Date(0).toISOString(),
    description: '',
  }
}

function starterCells(): Cell[] {
  return [
    {
      id: newId(),
      type: 'markdown',
      code:
        '# 🦈 Welcome to WebShark Data Studio\n\n' +
        'A zero-install data science IDE that runs **entirely in your browser**.\n\n' +
        '- Load data (or use the bundled samples in the left panel)\n' +
        '- Query it with **SQL** (DuckDB) or **Python** (pandas) — they share one data layer\n' +
        '- Cells are **reactive**: edit an upstream cell and downstream cells re-run\n' +
        '- **Profile** any table and annotate it in the Data Dictionary →\n\n' +
        'Try the SQL cell below.',
      status: 'idle',
    },
    {
      id: newId(),
      type: 'sql',
      name: 'tips_summary',
      code:
        '-- Tables you load appear as queryable names.\n' +
        'SELECT day, COUNT(*) AS n, ROUND(AVG(tip), 2) AS avg_tip\n' +
        'FROM tips\nGROUP BY day\nORDER BY n DESC;',
      status: 'idle',
    },
  ]
}

export const useStore = create<AppState>((set, get) => ({
  cells: starterCells(),
  tables: {},
  dictionary: {},
  project: defaultProject(),
  selectedCellId: null,
  selectedTable: null,
  inspectorTab: 'dictionary',
  reportMode: false,
  pythonStage: null,
  dirty: false,

  addCell: (type, afterId, init) => {
    const id = newId()
    const cell: Cell = { id, type, code: '', status: 'idle', ...init }
    set((s) => {
      const idx = afterId ? s.cells.findIndex((c) => c.id === afterId) : s.cells.length - 1
      const cells = [...s.cells]
      cells.splice(idx + 1, 0, cell)
      return { cells, selectedCellId: id, dirty: true }
    })
    return id
  },

  updateCell: (id, patch) =>
    set((s) => ({
      cells: s.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      dirty: true,
    })),

  setCellStatus: (id, status) =>
    set((s) => ({ cells: s.cells.map((c) => (c.id === id ? { ...c, status } : c)) })),

  setCellOutput: (id, output) =>
    set((s) => ({ cells: s.cells.map((c) => (c.id === id ? { ...c, output } : c)) })),

  removeCell: (id) =>
    set((s) => ({ cells: s.cells.filter((c) => c.id !== id), dirty: true })),

  moveCell: (id, dir) =>
    set((s) => {
      const idx = s.cells.findIndex((c) => c.id === id)
      const next = idx + dir
      if (idx < 0 || next < 0 || next >= s.cells.length) return s
      const cells = [...s.cells]
      ;[cells[idx], cells[next]] = [cells[next], cells[idx]]
      return { cells, dirty: true }
    }),

  selectCell: (id) => set({ selectedCellId: id }),

  setTables: (tables) => set({ tables }),

  setDictionary: (table, cols) =>
    set((s) => ({ dictionary: { ...s.dictionary, [table]: cols } })),

  updateColumnMeta: (table, col, patch) =>
    set((s) => {
      const cols = s.dictionary[table]
      if (!cols) return s
      return {
        dictionary: {
          ...s.dictionary,
          [table]: cols.map((c) => (c.name === col ? { ...c, ...patch } : c)),
        },
        dirty: true,
      }
    }),

  selectTable: (name) => set({ selectedTable: name, inspectorTab: 'dictionary' }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),

  setProject: (patch) => set((s) => ({ project: { ...s.project, ...patch }, dirty: true })),
  setReportMode: (on) => set({ reportMode: on }),
  setPythonStage: (stage) => set({ pythonStage: stage }),
  markClean: () => set({ dirty: false }),

  loadProject: (data) =>
    set({
      cells: data.cells,
      dictionary: data.dictionary,
      project: data.project,
      selectedCellId: null,
      selectedTable: null,
      dirty: false,
    }),

  reset: () =>
    set({
      cells: starterCells(),
      tables: {},
      dictionary: {},
      project: defaultProject(),
      selectedCellId: null,
      selectedTable: null,
      reportMode: false,
      dirty: false,
    }),
}))
