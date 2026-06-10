# 🦈 WebShark Data Studio

A **lightweight, high-performance sandbox for data science**. Isolate a data
transform or feature, **stress-test it against adversarial data, and prove it's
production-ready** before it ships — all in your browser, with nothing to
install.

Everything — SQL, Python, charts, profiling, data contracts, stress-tests —
runs entirely client-side via WebAssembly. There is no backend, which is exactly
why it can be hosted on GitHub Pages *and* why it's reproducible: every analysis
runs in the same deterministic sandbox.

Think of it as the data-science counterpart to WebShark for web dev: a place to
isolate features and stress-test code before production deployment.

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
| Reproducibility 6 months later | The whole project — cells, dictionary, chart specs, contracts, seed, and source data — serializes to one `.wsds.json` file. |
| Code breaks on bad data in prod | **⚡ Stress-test** harness rebuilds a transform's input with ~10 adversarial mutations (empty, single-row, duplicates, ×25 volume, null bombs, numeric extremes, blank/whitespace/mixed-case/unicode text) and reports what errors, drifts schema, or violates contracts — *before* deploy. |
| "Is this table production-ready?" | **Data contracts** — per-table rules (not-null, unique, range, allowed-values, regex, row-count) evaluated as in-engine SQL with exact violation counts and a live green/red status. |

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

## The sandbox: contracts + stress-testing

This is what makes WebShark a *sandbox* rather than a notebook.

- **Data contracts** (right Inspector → *Contracts* tab): pin rules that define
  "production-ready" for any table and click **Check** — each rule reports the
  exact count of violating rows, and the table gets a live green/red dot in the
  sidebar.
- **Stress-test** (`+ Stress-test` cell): pick a SQL/Python transform (any cell
  that reads a table and produces one). The harness backs up its input, rebuilds
  it from a library of adversarial mutations, re-runs the transform on each, and
  grades the outcome — error, schema drift, or contract violation — then restores
  your real data. Find the break before production does.

## Modeling (sandbox-native)

The **Model** cell trains & evaluates a model with scikit-learn (in Pyodide):
pick a table, target, features and algorithm (Random Forest / Logistic·Linear /
Decision Tree); the task (classification vs regression) is auto-detected. True to
the sandbox philosophy, every model is:

- **graded against a dumb baseline** (most-frequent / mean) — a model that can't
  beat it isn't learning, and the cell says so in red;
- **screened for leakage** — id-like, constant, or target-correlated features are
  flagged before they flatter your metrics;
- **stress-tested** — the held-out test set is perturbed (gaussian noise, zeroed
  values, shuffling the top feature) to show how stable the metric really is.

Plus a confusion matrix (classification) and feature importances.

Every training run is auto-logged to the **Experiments** cell — a comparison
table of params, metrics, baseline lift, leakage count, and robustness, with the
best run per target starred — so you can see what changed and what won.

## A/B testing (statistical experiments)

The **A/B test** cell answers causal/inferential questions, fully client-side
(DuckDB aggregates + in-house TypeScript statistics — no Pyodide). Pick a table,
a **variant** column and a **metric**: choose *proportion* (0/1 outcomes) or
*mean* (continuous). You get per-variant rates/means, **lift + 95% CI**, a
**p-value** (two-proportion z-test or Welch's t-test) and a significance gate —
plus a **sample-ratio-mismatch (SRM)** chi-square check that flags broken
randomization/logging before you trust anything. An SRM mismatch turns the
ship-ready banner red.

## Drift monitoring

The **Drift** cell compares a **current** dataset against a **baseline**, column by
column, to catch silent distribution shift before it breaks a model or report.
Each shared column gets a **PSI** (population stability index) score — <0.10
stable, 0.10–0.25 moderate, >0.25 significant — plus null-rate change, mean shift
and a KS statistic (numeric), and new/missing categories (categorical). Columns
are sorted by severity; an overall roll-up rates the dataset. Significant drift
turns the ship-ready banner red. Pure client-side (DuckDB + TS, no Pyodide).

## Ship-ready at a glance

The toolbar shows one colored pill that summarizes whether the whole analysis is
production-ready: **green** when every data contract passes, every model beats
its baseline, no A/B test has a sample-ratio mismatch, and no dataset shows
significant drift; **red** (with a count) when something fails; **grey** when
there's nothing to check yet. Click it to jump straight to the problem.

## Roadmap

The cell + DAG + shared-data-layer core is built so later workflows slot in as
new cell types / panels — e.g. LLM/RAG evaluation harnesses and richer pipeline
orchestration.
