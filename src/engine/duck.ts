// ---------------------------------------------------------------------------
// DuckDB-WASM: the shared data layer.
//
// All tabular data in WebShark lives as DuckDB tables. SQL cells query them
// directly; Python cells read them into pandas (via Arrow) and publish back;
// charts and profiling operate on any table. One engine, one source of truth.
//
// HOSTING NOTE: GitHub Pages cannot send COOP/COEP headers, so cross-origin
// isolation / SharedArrayBuffer is unavailable. duckdb.selectBundle() detects
// this (globalThis.crossOriginIsolated === false) and picks the single-threaded
// "eh" (exception-handling) bundle automatically — exactly what we want. We do
// NOT force the threaded "coi" bundle.
// ---------------------------------------------------------------------------

import * as duckdb from '@duckdb/duckdb-wasm'
import type { Table as ArrowTable } from 'apache-arrow'
import type { TablePreview } from '../types'

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null

async function createDb(): Promise<duckdb.AsyncDuckDB> {
  const bundles = duckdb.getJsDelivrBundles()
  // selectBundle picks "eh" when not cross-origin-isolated (GitHub Pages case).
  const bundle = await duckdb.selectBundle(bundles)
  const worker = await duckdb.createWorker(bundle.mainWorker!)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  await db.open({ query: { castBigIntToDouble: true } })
  return db
}

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = createDb()
  return dbPromise
}

async function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = getDb().then((db) => db.connect())
  }
  return connPromise
}

/** Reset the entire engine: drop all tables and reconnect (fresh kernel). */
export async function resetEngine(): Promise<void> {
  const conn = await getConn()
  const tables = await listTables()
  for (const t of tables) {
    try {
      await conn.query(`DROP TABLE IF EXISTS "${t}"`)
    } catch {
      try {
        await conn.query(`DROP VIEW IF EXISTS "${t}"`)
      } catch {
        /* ignore */
      }
    }
  }
}

/** Run a SQL statement and return the raw Arrow result. */
export async function queryArrow(sql: string): Promise<ArrowTable> {
  const conn = await getConn()
  return (await conn.query(sql)) as unknown as ArrowTable
}

/** Sanitize Arrow scalar values into JSON-safe JS values. */
function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    // Arrow Decimal, nested structs, lists -> stringify for display.
    try {
      const obj = value as { toJSON?: () => unknown; toString?: () => string }
      if (typeof obj.toJSON === 'function') return obj.toJSON()
      if (typeof obj.toString === 'function') return obj.toString()
    } catch {
      /* fall through */
    }
    return String(value)
  }
  return value
}

/** Convert an Arrow table to a preview slice of plain JS row objects. */
export function arrowToPreview(table: ArrowTable, limit = 200): TablePreview {
  const columns = table.schema.fields.map((f) => f.name)
  const total = table.numRows
  const rows: Record<string, unknown>[] = []
  const n = Math.min(total, limit)
  for (let i = 0; i < n; i++) {
    const r = table.get(i)
    const obj: Record<string, unknown> = {}
    if (r) {
      const json = r.toJSON() as Record<string, unknown>
      for (const c of columns) obj[c] = sanitize(json[c])
    }
    rows.push(obj)
  }
  return { columns, rows, totalRows: total, truncated: total > n }
}

/** Run SQL and return a display-ready preview. */
export async function queryPreview(sql: string, limit = 200): Promise<TablePreview> {
  const table = await queryArrow(sql)
  return arrowToPreview(table, limit)
}

/** Convert an entire Arrow table to plain JS rows (for charts / export). */
export function arrowToRows(table: ArrowTable): Record<string, unknown>[] {
  const columns = table.schema.fields.map((f) => f.name)
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < table.numRows; i++) {
    const r = table.get(i)
    const obj: Record<string, unknown> = {}
    if (r) {
      const json = r.toJSON() as Record<string, unknown>
      for (const c of columns) obj[c] = sanitize(json[c])
    }
    rows.push(obj)
  }
  return rows
}

/** List user-visible base tables and views. */
export async function listTables(): Promise<string[]> {
  const conn = await getConn()
  const res = await conn.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'main' ORDER BY table_name`,
  )
  return (res.toArray() as Array<{ table_name: string }>).map((r) => r.table_name)
}

export interface ColumnInfo {
  name: string
  type: string
}

export async function describeTable(name: string): Promise<ColumnInfo[]> {
  const conn = await getConn()
  const res = await conn.query(`DESCRIBE "${name}"`)
  return (res.toArray() as Array<{ column_name: string; column_type: string }>).map(
    (r) => ({ name: r.column_name, type: r.column_type }),
  )
}

export async function countRows(name: string): Promise<number> {
  const conn = await getConn()
  const res = await conn.query(`SELECT COUNT(*)::BIGINT AS n FROM "${name}"`)
  const row = res.get(0) as { n: bigint | number } | null
  return row ? Number(row.n) : 0
}

export async function dropTable(name: string): Promise<void> {
  const conn = await getConn()
  await conn.query(`DROP TABLE IF EXISTS "${name}"`)
  await conn.query(`DROP VIEW IF EXISTS "${name}"`)
}

function sanitizeTableName(raw: string): string {
  const base = raw
    .replace(/\.[^.]+$/, '') // strip extension
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1')
  return base || 'dataset'
}

/** Load CSV text into a new table. Returns the created table name. */
export async function loadCsvText(
  rawName: string,
  csvText: string,
): Promise<string> {
  const db = await getDb()
  const conn = await getConn()
  const tableName = sanitizeTableName(rawName)
  const fileName = `${tableName}.csv`
  await db.registerFileText(fileName, csvText)
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`)
  await conn.query(
    `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${fileName}', SAMPLE_SIZE=-1)`,
  )
  return tableName
}

/** Load a binary file (parquet / arrow) into a new table. */
export async function loadBinaryFile(
  rawName: string,
  buffer: Uint8Array,
): Promise<string> {
  const db = await getDb()
  const conn = await getConn()
  const tableName = sanitizeTableName(rawName)
  const isParquet = /\.parquet$/i.test(rawName)
  const isJson = /\.jsonl?$/i.test(rawName)
  const fileName = rawName.replace(/[^a-zA-Z0-9_.]/g, '_')
  await db.registerFileBuffer(fileName, buffer)
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`)
  const reader = isParquet
    ? `read_parquet('${fileName}')`
    : isJson
      ? `read_json_auto('${fileName}')`
      : `read_csv_auto('${fileName}', SAMPLE_SIZE=-1)`
  await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM ${reader}`)
  return tableName
}

/** Load a dataset from a URL (fetched client-side). */
export async function loadFromUrl(url: string, name?: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`)
  const guessName = name || url.split('/').pop() || 'remote'
  if (/\.parquet$/i.test(url) || /\.arrow$/i.test(url)) {
    const buf = new Uint8Array(await resp.arrayBuffer())
    return loadBinaryFile(guessName, buf)
  }
  const text = await resp.text()
  if (/\.jsonl?$/i.test(url)) {
    const buf = new TextEncoder().encode(text)
    return loadBinaryFile(guessName.endsWith('.json') ? guessName : `${guessName}.json`, buf)
  }
  return loadCsvText(guessName, text)
}

/** Export a table to CSV text (for project save). */
export async function tableToCsv(name: string): Promise<string> {
  const db = await getDb()
  const conn = await getConn()
  const outFile = `__export_${name}.csv`
  await conn.query(
    `COPY "${name}" TO '${outFile}' (FORMAT CSV, HEADER)`,
  )
  const buf = await db.copyFileToBuffer(outFile)
  await db.dropFile(outFile)
  return new TextDecoder().decode(buf)
}

/** Register an Arrow IPC buffer as a table (used by the Python bridge). */
export async function registerArrowIpc(
  name: string,
  ipc: Uint8Array,
): Promise<void> {
  const conn = await getConn()
  const tableName = sanitizeTableName(name)
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`)
  await conn.insertArrowFromIPCStream(ipc, { name: tableName, create: true })
}

/** Get an Arrow IPC stream of a table (used by the Python bridge). */
export async function tableToArrowIpc(name: string): Promise<Uint8Array> {
  const table = await queryArrow(`SELECT * FROM "${name}"`)
  const { tableToIPC } = await import('apache-arrow')
  return tableToIPC(table, 'stream')
}
