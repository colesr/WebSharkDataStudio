# 🦈 WebShark Data Studio

A **zero-install, reproducible, browser-native data science IDE**. Everything —
SQL, Python, charts, profiling — runs entirely client-side in your browser via
WebAssembly. There is no backend, which is exactly why it can be hosted on
GitHub Pages *and* why it's reproducible: every analysis runs in the same
deterministic sandbox.

**Live:** https://colesr.github.io/WebSharkDataStudio/

---

## Why it exists

Data science workflows share a stubborn set of pain points. WebShark is designed
so that its *architecture* — not bolted-on features — answers them:

| Pain point | WebShark's answer |
|---|---|
| 40–80% of time is data-janitor work | One-click **auto-profiling** + an editable **data dictionary**; drag-drop load; instant SQL over any file. |
| Notebooks run out of order / hidden state | A **reactive DAG** — edit an upstream cell and every dependent re-runs; order is derived from the code, not from you. |
| "Works on my machine" / env hell | Everyone runs the **same WASM sandbox**. Pinned seed + **Run fresh** (reset kernel, reload sources, re-run top to bottom). |
| Tool sprawl / interop | **One shared data layer** (DuckDB). SQL, Python (pandas), charts and profiling all read/write the same tables. |
| Columns nobody remembers | **Data dictionary** with auto-inferred *semantic* types (id / email / currency / category / datetime…) + editable notes, saved with the project. |
| Reporting is an afterthought | **Report mode** hides code; **Export HTML** produces a single shareable file. |
| Reproducibility 6 months later | The whole project — cells, dictionary, chart specs, seed, and source data — serializes to one `.wsds.json` file. |

## What's inside

- **DuckDB-WASM** — SQL engine *and* the shared table store.
- **Pyodide** — real CPython + pandas/numpy (lazy-loaded on first Python cell).
- **Apache Arrow** — zero-copy interchange between SQL ⇄ Python.
- **Vega-Lite** — point-and-click charts whose specs serialize cleanly.
- **CodeMirror 6**, **React**, **Vite**, **TypeScript**, **Zustand**.

## The data bridge

SQL cells just reference table names. Python cells cross the boundary through one
explicit object, which also tells the reactive engine what each cell depends on:

```python
df = ws.table("orders")        # DuckDB table  -> pandas.DataFrame
df = df[df.total > 0]
ws.publish("clean_orders", df) # pandas.DataFrame -> DuckDB table (now queryable in SQL)
```

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
deploys `dist/` to GitHub Pages. In the repo: **Settings → Pages → Build and
deployment → Source: GitHub Actions**.

> **Note on WebAssembly:** GitHub Pages can't send COOP/COEP headers, so we
> deliberately use the single-threaded, non-cross-origin-isolated DuckDB-WASM
> bundle and the default Pyodide build (no `SharedArrayBuffer` required).

## Roadmap

The cell + DAG + shared-data-layer core is built so later workflows slot in as
new cell types / panels: experiment tracking, A/B-test statistics, model
training with scikit-learn, drift monitoring, and LLM/RAG evaluation harnesses.
