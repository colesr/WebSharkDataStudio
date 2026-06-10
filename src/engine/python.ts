// ---------------------------------------------------------------------------
// Python runtime — real CPython via Pyodide (lazy-loaded from CDN).
//
// The bridge between Python and the shared DuckDB data layer is an explicit
// `ws` object inside Python:
//
//     df = ws.table("orders")        # DuckDB table  -> pandas.DataFrame
//     ws.publish("clean", df)        # pandas.DataFrame -> DuckDB table
//
// The explicitness is deliberate: it doubles as the dependency signal for the
// reactive DAG (no fragile AST scanning), and it keeps training/serving-skew
// style surprises away — there is exactly one place data crosses the boundary.
//
// Interchange is Apache Arrow IPC (pyarrow <-> apache-arrow), so no CSV
// round-tripping and types are preserved.
// ---------------------------------------------------------------------------

import { loadCsvText, tableToCsv } from './duck'

const PYODIDE_VERSION = 'v0.26.4'
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`

let pyodidePromise: Promise<any> | null = null
let loadListeners: ((stage: string) => void)[] = []

export function onPythonLoad(cb: (stage: string) => void): () => void {
  loadListeners.push(cb)
  return () => {
    loadListeners = loadListeners.filter((l) => l !== cb)
  }
}
function notify(stage: string) {
  for (const l of loadListeners) l(stage)
}

export function isPythonLoaded(): boolean {
  return pyodidePromise !== null
}

async function bootPyodide(): Promise<any> {
  notify('Loading Pyodide runtime…')
  // Load the Pyodide loader script from CDN (ESM).
  const mod: any = await import(/* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`)
  const pyodide = await mod.loadPyodide({ indexURL: PYODIDE_INDEX })

  notify('Installing pandas & numpy…')
  await pyodide.loadPackage(['pandas', 'numpy'])

  // Capture stdout/stderr.
  pyodide.setStdout({ batched: (s: string) => pushStdout(s) })
  pyodide.setStderr({ batched: (s: string) => pushStdout(s) })

  // Bootstrap the ws bridge + matplotlib-to-PNG helper.
  //
  // Data crosses the boundary synchronously as CSV text: JS pre-loads the CSV
  // for every table the cell declares it reads into `_ws_inputs` *before* the
  // cell runs, and collects everything the cell publishes from `_ws_outputs`
  // *after*. This keeps Python deps to just pandas+numpy and avoids awaiting
  // async JS from synchronous Python.
  await pyodide.runPythonAsync(`
import io, sys, json, base64
import pandas as pd

_ws_inputs = None     # JS Map<name, csv-text>, set per-run by JS
_ws_outputs = {}      # name -> csv-text, drained per-run by JS

class _WS:
    """WebShark bridge to the shared DuckDB data layer."""
    def table(self, name):
        csv = _ws_inputs.get(name) if _ws_inputs is not None else None
        if csv is None:
            raise KeyError(
                "Table '%s' is not loaded. Read tables with a literal name, "
                "e.g. ws.table('%s')." % (name, name))
        return pd.read_csv(io.StringIO(str(csv)))
    def publish(self, name, df):
        if not isinstance(df, pd.DataFrame):
            df = pd.DataFrame(df)
        _ws_outputs[name] = df.to_csv(index=False)
        return name

ws = _WS()

def _render_matplotlib():
    """If matplotlib has open figures, return the first as a PNG data URL."""
    try:
        import matplotlib
        import matplotlib.pyplot as plt
    except Exception:
        return None
    figs = [plt.figure(n) for n in plt.get_fignums()]
    if not figs:
        return None
    buf = io.BytesIO()
    figs[0].savefig(buf, format='png', dpi=110, bbox_inches='tight')
    plt.close('all')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
`)

  notify('Python ready')
  return pyodide
}

export function getPyodide(): Promise<any> {
  if (!pyodidePromise) pyodidePromise = bootPyodide()
  return pyodidePromise
}

let stdoutBuffer: string[] = []
function pushStdout(s: string) {
  stdoutBuffer.push(s)
}

export interface PyRunResult {
  stdout: string
  result?: string
  image?: string
  publishedTables: string[]
}

/** Reset the Python namespace (fresh kernel) while keeping the loaded runtime. */
export async function resetPython(): Promise<void> {
  if (!pyodidePromise) return
  const pyodide = await pyodidePromise
  await pyodide.runPythonAsync(`
for _k in [k for k in list(globals().keys())
           if not k.startswith('_') and k not in ('ws','pd','pa','io','sys','json','base64')]:
    del globals()[_k]
`)
}

/**
 * Run Python source. The `ws` bridge reads/writes DuckDB tables on demand.
 * We auto-install the JS callbacks each run so the connection stays current.
 */
export async function runPython(code: string, seed?: number): Promise<PyRunResult> {
  const pyodide = await getPyodide()
  stdoutBuffer = []

  // Pre-load CSV for every table the cell declares it reads.
  const { reads } = pythonDeps(code)
  const inputs = new Map<string, string>()
  for (const name of reads) {
    try {
      inputs.set(name, await tableToCsv(name))
    } catch {
      /* table may not exist yet; ws.table will raise a clear error */
    }
  }
  pyodide.globals.set('_ws_inputs', inputs)
  // Reset the per-run output collector.
  await pyodide.runPythonAsync('_ws_outputs = {}')

  // Pin seeds for reproducibility before user code runs.
  if (seed != null) {
    await pyodide.runPythonAsync(`
import random as _r
_r.seed(${seed})
try:
    import numpy as _np
    _np.random.seed(${seed})
except Exception:
    pass
`)
  }

  let result: string | undefined
  try {
    const value = await pyodide.runPythonAsync(code)
    if (value !== undefined && value !== null) {
      // Use Python repr for nice formatting of DataFrames etc.
      const reprFn = pyodide.globals.get('repr')
      try {
        result = reprFn(value).toString()
      } catch {
        result = String(value)
      }
      if (value?.destroy) value.destroy()
    }
  } catch (err) {
    throw new Error(String((err as Error).message || err))
  }

  // Drain published tables (CSV) and register them back into DuckDB.
  const published: string[] = []
  try {
    const outputs = pyodide.globals.get('_ws_outputs')
    const map = outputs.toJs() as Map<string, string>
    for (const [name, csv] of map) {
      await loadCsvText(name, csv)
      published.push(name)
    }
    outputs.destroy?.()
  } catch (err) {
    console.warn('Failed to drain ws.publish outputs', err)
  }

  let image: string | undefined
  try {
    const png = await pyodide.runPythonAsync('_render_matplotlib()')
    if (png) image = String(png)
  } catch {
    /* matplotlib not used */
  }

  return {
    stdout: stdoutBuffer.join(''),
    result,
    image,
    publishedTables: published,
  }
}

/** Best-effort dependency detection: ws.table("x") reads and ws.publish("y"). */
export function pythonDeps(code: string): { reads: string[]; writes: string[] } {
  const reads = new Set<string>()
  const writes = new Set<string>()
  const readRe = /ws\.table\(\s*["']([^"']+)["']/g
  const writeRe = /ws\.publish\(\s*["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = readRe.exec(code))) reads.add(m[1])
  while ((m = writeRe.exec(code))) writes.add(m[1])
  return { reads: [...reads], writes: [...writes] }
}
