// ---------------------------------------------------------------------------
// Source dataset registry.
//
// Records how each *source* table (loaded file, sample, or URL) was created so
// it can be recreated on a fresh-kernel run-all and embedded into the project
// file. Derived tables (from SQL/Python cells) are NOT registered here — they
// are reproduced by re-running their cells.
// ---------------------------------------------------------------------------

import { loadCsvText, loadFromUrl } from './duck'
import type { EmbeddedDataset } from '../types'

const sources = new Map<string, EmbeddedDataset>()

export function registerCsvSource(
  name: string,
  csvText: string,
  source: EmbeddedDataset['source'] = 'file',
): void {
  sources.set(name, { name, kind: 'csv', content: csvText, source })
}

export function registerUrlSource(name: string, url: string): void {
  sources.set(name, { name, kind: 'url', content: url, source: 'file' })
}

export function unregisterSource(name: string): void {
  sources.delete(name)
}

export function listSources(): EmbeddedDataset[] {
  return [...sources.values()]
}

export function setSources(datasets: EmbeddedDataset[]): void {
  sources.clear()
  for (const d of datasets) sources.set(d.name, d)
}

/** Recreate all registered source tables in DuckDB (used on fresh run). */
export async function reloadSources(): Promise<void> {
  for (const d of sources.values()) {
    try {
      if (d.kind === 'csv') await loadCsvText(d.name, d.content)
      else await loadFromUrl(d.content, d.name)
    } catch (err) {
      console.warn(`Failed to reload source ${d.name}`, err)
    }
  }
}
