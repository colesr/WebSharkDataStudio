// ---------------------------------------------------------------------------
// Export the current notebook as a single self-contained HTML report.
//
// Markdown, tables and profiles are baked to static HTML; charts embed their
// Vega-Lite spec (data inlined) and render via the Vega CDN scripts. The file
// opens standalone in any browser — the shareable artifact for stakeholders.
// ---------------------------------------------------------------------------

import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useStore } from '../../state/store'
import { downloadText } from '../../engine/persistence'
import type { Cell, TablePreview } from '../../types'
import type { TableProfile } from '../../engine/profile'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function tableHtml(t: TablePreview): string {
  const head = `<tr><th>#</th>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`
  const body = t.rows
    .map(
      (r, i) =>
        `<tr><td class="i">${i + 1}</td>${t.columns
          .map((c) => {
            const v = r[c]
            const cls = typeof v === 'number' ? 'num' : v == null ? 'nul' : ''
            const text = v == null ? 'null' : typeof v === 'number' ? v.toLocaleString() : esc(v)
            return `<td class="${cls}">${text}</td>`
          })
          .join('')}</tr>`,
    )
    .join('')
  const meta = `<div class="meta">${t.totalRows.toLocaleString()} rows × ${t.columns.length} cols${
    t.truncated ? ` · first ${t.rows.length}` : ''
  }</div>`
  return `<div class="tbl-wrap"><table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>${meta}</div>`
}

function profileHtml(p: TableProfile): string {
  const rows = p.columns
    .map((c) => {
      const stats =
        c.kind === 'numeric' && c.mean != null
          ? `μ ${c.mean.toPrecision(3)} σ ${c.std?.toPrecision(3)} [${c.min?.toPrecision(3)}, ${c.max?.toPrecision(3)}]`
          : c.topValues
            ? c.topValues.slice(0, 3).map((v) => `${esc(v.value)} (${v.count})`).join(', ')
            : ''
      return `<tr><td><b>${esc(c.name)}</b></td><td>${c.kind}</td><td>${c.nullPct.toFixed(
        0,
      )}%</td><td>${c.distinct}</td><td>${stats}</td></tr>`
    })
    .join('')
  return `<div class="tbl-wrap"><div class="meta">${esc(p.table)} · ${p.rowCount.toLocaleString()} rows</div>
    <table class="tbl"><thead><tr><th>column</th><th>type</th><th>nulls</th><th>distinct</th><th>stats</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

function cellHtml(cell: Cell, chartId: { n: number }, specs: string[]): string {
  if (cell.type === 'markdown') {
    return `<div class="block">${DOMPurify.sanitize(marked.parse(cell.code, { async: false }) as string)}</div>`
  }
  if (cell.type === 'chart' && cell.output?.vegaSpec) {
    const id = `chart_${chartId.n++}`
    specs.push(`vegaEmbed('#${id}', ${JSON.stringify(cell.output.vegaSpec)}, {actions:false});`)
    return `<div class="block"><div id="${id}"></div></div>`
  }
  if (cell.type === 'profile' && cell.output?.profile) {
    return `<div class="block">${profileHtml(cell.output.profile as TableProfile)}</div>`
  }
  if ((cell.type === 'sql' || cell.type === 'python') && cell.output?.table) {
    const caption = cell.name ? `<div class="cap">${esc(cell.name)}</div>` : ''
    return `<div class="block">${caption}${tableHtml(cell.output.table)}</div>`
  }
  if ((cell.type === 'sql' || cell.type === 'python') && cell.output?.image) {
    return `<div class="block"><img src="${cell.output.image}" style="max-width:100%"/></div>`
  }
  return ''
}

export function exportReportHtml(): void {
  const s = useStore.getState()
  const chartId = { n: 0 }
  const specs: string[] = []
  const body = s.cells.map((c) => cellHtml(c, chartId, specs)).join('\n')
  const hasCharts = specs.length > 0

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(s.project.name)} — WebShark report</title>
${
  hasCharts
    ? `<script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>`
    : ''
}
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:860px;margin:0 auto;padding:40px 24px 100px;color:#1c2230;background:#fff;line-height:1.6}
  h1{border-bottom:1px solid #e2e6ea;padding-bottom:10px}
  .block{margin:24px 0}
  .cap{font-family:ui-monospace,monospace;font-size:12px;color:#7a8696;margin-bottom:6px}
  .tbl-wrap{border:1px solid #e2e6ea;border-radius:8px;overflow:auto;max-height:460px}
  table.tbl{border-collapse:collapse;width:100%;font-family:ui-monospace,monospace;font-size:12px}
  table.tbl th{position:sticky;top:0;background:#f3f5f7;text-align:left;padding:6px 10px;border-bottom:1px solid #e2e6ea}
  table.tbl td{padding:4px 10px;border-bottom:1px solid #eef1f3;white-space:nowrap}
  td.num{text-align:right;color:#1f6feb}
  td.nul{color:#aab2bd;font-style:italic}
  td.i{color:#c2c9d2}
  .meta{padding:5px 10px;font-size:11px;color:#7a8696}
  code{background:#f3f5f7;padding:1px 5px;border-radius:4px;font-family:ui-monospace,monospace}
  pre{background:#f3f5f7;padding:10px;border-radius:6px;overflow:auto}
  .footer{margin-top:50px;color:#aab2bd;font-size:11px}
</style></head>
<body>
<h1>${esc(s.project.name)}</h1>
${s.project.description ? `<p style="color:#5c6675">${esc(s.project.description)}</p>` : ''}
${body}
<div class="footer">Generated with 🦈 WebShark Data Studio · seed ${s.project.seed}</div>
${hasCharts ? `<script>${specs.join('\n')}</script>` : ''}
</body></html>`

  const name = `${s.project.name.replace(/[^a-z0-9]+/gi, '_')}_report.html`
  downloadText(name, html, 'text/html')
}
