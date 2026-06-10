// ---------------------------------------------------------------------------
// Core domain types for WebShark Data Studio.
// ---------------------------------------------------------------------------

export type CellType = 'sql' | 'python' | 'markdown' | 'chart' | 'profile'

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

export interface ProjectFile {
  app: 'webshark-data-studio'
  version: number
  meta: ProjectMeta
  cells: Cell[]
  dictionary: Record<string, ColumnMeta[]>
  datasets: EmbeddedDataset[]
}
