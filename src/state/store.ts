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
  ContractRule,
  ContractRuleResult,
  ContractStatus,
  ExperimentRun,
  ProjectMeta,
  TableMeta,
} from '../types'

let idCounter = 0
export function newId(prefix = 'c'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

export type InspectorTab = 'dictionary' | 'profile' | 'contracts'

interface AppState {
  cells: Cell[]
  tables: Record<string, TableMeta>
  dictionary: Record<string, ColumnMeta[]>
  contracts: Record<string, ContractRule[]>
  contractStatus: Record<string, ContractStatus>
  contractResults: Record<string, ContractRuleResult[]>
  experiments: ExperimentRun[]
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
  moveCellTo: (id: string, toIndex: number) => void
  selectCell: (id: string | null) => void

  // catalog
  setTables: (tables: Record<string, TableMeta>) => void
  setDictionary: (table: string, cols: ColumnMeta[]) => void
  updateColumnMeta: (table: string, col: string, patch: Partial<ColumnMeta>) => void
  selectTable: (name: string | null) => void
  setInspectorTab: (tab: InspectorTab) => void

  // contracts
  setContract: (table: string, rules: ContractRule[]) => void
  setContractStatus: (table: string, status: ContractStatus) => void
  setContractResults: (table: string, results: ContractRuleResult[], status: ContractStatus) => void
  clearContractResults: (table: string) => void

  // experiments
  addExperiment: (run: ExperimentRun) => void
  clearExperiments: () => void

  // project / ui
  setProject: (patch: Partial<ProjectMeta>) => void
  setReportMode: (on: boolean) => void
  setPythonStage: (stage: string | null) => void
  markClean: () => void
  loadProject: (data: {
    cells: Cell[]
    dictionary: Record<string, ColumnMeta[]>
    contracts: Record<string, ContractRule[]>
    experiments: ExperimentRun[]
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
        '# 🦈 WebShark Data Studio\n\n' +
        'A lightweight, high-performance **sandbox for data science** — isolate a transform, ' +
        '**stress-test it against adversarial data, and prove it’s production-ready** before it ships. ' +
        'Runs **entirely in your browser**; nothing to install.\n\n' +
        '- Load data (or use the bundled samples ←) and query with **SQL** or **Python** over one shared data layer\n' +
        '- Cells are **reactive** — edit upstream, downstream re-runs (no stale hidden state)\n' +
        '- **Profile** + annotate columns in the Data Dictionary, and pin **Contracts** that define "production-ready" →\n' +
        '- **⚡ Stress-test** any transform with empty/duplicate/×25-volume/null-bomb/unicode inputs to find what breaks *first*\n\n' +
        'Run the SQL cell below, then try `+ Stress-test` on it.',
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
  contracts: {},
  contractStatus: {},
  contractResults: {},
  experiments: [],
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

  moveCellTo: (id, toIndex) =>
    set((s) => {
      const from = s.cells.findIndex((c) => c.id === id)
      if (from < 0) return s
      const cells = [...s.cells]
      const [moved] = cells.splice(from, 1)
      const clamped = Math.max(0, Math.min(cells.length, toIndex))
      cells.splice(clamped, 0, moved)
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

  setContract: (table, rules) =>
    set((s) => ({ contracts: { ...s.contracts, [table]: rules }, dirty: true })),

  setContractStatus: (table, status) =>
    set((s) => ({ contractStatus: { ...s.contractStatus, [table]: status } })),

  setContractResults: (table, results, status) =>
    set((s) => ({
      contractResults: { ...s.contractResults, [table]: results },
      contractStatus: { ...s.contractStatus, [table]: status },
    })),

  clearContractResults: (table) =>
    set((s) => {
      const results = { ...s.contractResults }
      const status = { ...s.contractStatus }
      delete results[table]
      delete status[table]
      return { contractResults: results, contractStatus: status }
    }),

  addExperiment: (run) =>
    set((s) => ({ experiments: [...s.experiments, run], dirty: true })),

  clearExperiments: () => set({ experiments: [], dirty: true }),

  setProject: (patch) => set((s) => ({ project: { ...s.project, ...patch }, dirty: true })),
  setReportMode: (on) => set({ reportMode: on }),
  setPythonStage: (stage) => set({ pythonStage: stage }),
  markClean: () => set({ dirty: false }),

  loadProject: (data) =>
    set({
      cells: data.cells,
      dictionary: data.dictionary,
      contracts: data.contracts,
      contractStatus: {},
      contractResults: {},
      experiments: data.experiments,
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
      contracts: {},
      contractStatus: {},
      contractResults: {},
      experiments: [],
      project: defaultProject(),
      selectedCellId: null,
      selectedTable: null,
      reportMode: false,
      dirty: false,
    }),
}))
