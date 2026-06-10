// ---------------------------------------------------------------------------
// Core domain types for WebShark Data Studio.
// ---------------------------------------------------------------------------

export type CellType =
  | 'sql'
  | 'python'
  | 'markdown'
  | 'chart'
  | 'profile'
  | 'stress'
  | 'model'
  | 'experiments'
  | 'abtest'

export type CellStatus = 'idle' | 'stale' | 'running' | 'ok' | 'error'

/** A serialized table value rendered as an output (small preview slice). */
export interface TablePreview {
  columns: string[]
  /** Row objects keyed by column name (already JS-native values). */
  rows: Record<string, unknown>[]
  /** Total row count of the underlying table (may exceed rows.length). */
  totalRows: number
  truncated: boolean
}

export interface CellOutput {
  /** Tabular preview, when the cell produced a table. */
  table?: TablePreview
  /** Plain text (stdout, repr, errors rendered separately). */
  text?: string
  /** PNG data URL (e.g. matplotlib figures from Python). */
  image?: string
  /** Vega-Lite spec for chart cells / profile histograms. */
  vegaSpec?: unknown
  /** TableProfile result for profile cells (see engine/profile.ts). */
  profile?: unknown
  /** StressResult[] for stress cells (see engine/stress.ts). */
  stress?: unknown
  /** ModelResult for model cells (see engine/model.ts). */
  model?: unknown
  /** ABResult for abtest cells (see engine/abtest.ts). */
  abtest?: unknown
  /** Error message, if the run failed. */
  error?: string
  /** Wall-clock duration of the last run, ms. */
  durationMs?: number
}

/** Encodings for the point-and-click chart builder. */
export interface ChartSpec {
  table: string
  mark: 'bar' | 'line' | 'point' | 'area' | 'tick' | 'arc'
  x?: string
  y?: string
  color?: string
  aggregate?: 'none' | 'count' | 'sum' | 'mean' | 'median' | 'min' | 'max'
  xType?: 'auto' | 'quantitative' | 'nominal' | 'ordinal' | 'temporal'
  yType?: 'auto' | 'quantitative' | 'nominal' | 'ordinal' | 'temporal'
}

export interface ModelSpec {
  table: string
  target?: string
  /** Empty/undefined ⇒ all columns except the target. */
  features?: string[]
  algo: 'linear' | 'tree' | 'forest'
}

export interface ABSpec {
  table: string
  variantCol?: string
  metricCol?: string
  metricType: 'mean' | 'proportion'
  /** Control variant name; defaults to the first variant. */
  control?: string
  /** Significance level (default 0.05). */
  alpha?: number
}

export interface Cell {
  id: string
  type: CellType
  /** Source code / markdown text. */
  code: string
  /** Output table name this cell publishes (sql/python). */
  name?: string
  /** Chart configuration for chart cells. */
  chart?: ChartSpec
  /** Table name a profile cell targets. */
  profileTarget?: string
  /** Stress-test configuration for stress cells. */
  stressTarget?: { cellId?: string }
  /** Model configuration for model cells. */
  model?: ModelSpec
  /** A/B test configuration for abtest cells. */
  abtest?: ABSpec
  status: CellStatus
  output?: CellOutput
  /** Whether the editor is collapsed. */
  collapsed?: boolean
}

export type SemanticType =
  | 'id'
  | 'email'
  | 'category'
  | 'datetime'
  | 'currency'
  | 'boolean'
  | 'numeric'
  | 'text'
  | 'url'
  | 'unknown'

export interface ColumnMeta {
  name: string
  /** DuckDB physical type. */
  physicalType: string
  semanticType: SemanticType
  nullPct: number
  distinctCount?: number
  sampleValues: string[]
  /** User-editable. */
  description: string
  tags: string[]
}

export interface TableMeta {
  name: string
  rowCount: number
  columns: ColumnMeta[]
  /** Where the table came from: a loaded file, a query, or python. */
  source: 'file' | 'sql' | 'python' | 'sample'
  /** Origin detail (filename/url) — used to reload on fresh runs. */
  origin?: string
}

export interface ProjectMeta {
  name: string
  seed: number
  createdAt: string
  description: string
}

/** Datasets that travel inside the .wsds.json project file. */
export interface EmbeddedDataset {
  name: string
  /** 'csv' embedded as text, or 'url' as a reloadable reference. */
  kind: 'csv' | 'url'
  /** CSV text (kind=csv) or the URL (kind=url). */
  content: string
  source: TableMeta['source']
}

// ---- Data contracts (production-readiness rules per table) -----------------

export type ContractRuleType =
  | 'not_null'
  | 'unique'
  | 'range'
  | 'allowed_values'
  | 'regex'
  | 'row_count'

export interface ContractRule {
  id: string
  type: ContractRuleType
  column?: string
  min?: number
  max?: number
  values?: string[]
  pattern?: string
}

export interface ContractRuleResult {
  rule: ContractRule
  passed: boolean
  /** Rows violating the rule (-1 if the check itself errored). */
  failingRows: number
  total: number
  detail?: string
}

export interface ContractStatus {
  passed: number
  failed: number
  errored: number
}

// ---- Experiment tracking ---------------------------------------------------

export interface ExperimentRun {
  id: string
  ts: string
  cellId: string
  table: string
  target: string
  task: 'classification' | 'regression'
  algo: string
  nFeatures: number
  nTrain: number
  nTest: number
  seed: number
  primaryName: string
  primaryModel: number
  primaryBaseline: number
  beatsBaseline: boolean
  metrics: Record<string, number>
  leakageCount: number
  /** Most negative metric delta across stress perturbations (null if none). */
  worstStressDelta: number | null
}

export interface ProjectFile {
  app: 'webshark-data-studio'
  version: number
  meta: ProjectMeta
  cells: Cell[]
  dictionary: Record<string, ColumnMeta[]>
  contracts: Record<string, ContractRule[]>
  experiments: ExperimentRun[]
  datasets: EmbeddedDataset[]
}
