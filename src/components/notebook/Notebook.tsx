import { useStore } from '../../state/store'
import { CellView } from './Cell'
import type { CellType } from '../../types'

export function Notebook() {
  const cells = useStore((s) => s.cells)
  const addCell = useStore((s) => s.addCell)
  const selectedCellId = useStore((s) => s.selectedCellId)

  function add(type: CellType) {
    const init =
      type === 'python'
        ? { code: '# pandas via Pyodide. Read/write the shared data layer with `ws`.\n# df = ws.table("tips")\n# df.describe()' }
        : type === 'sql'
          ? { code: 'SELECT * FROM tips LIMIT 20;' }
          : type === 'markdown'
            ? { code: '## New note' }
            : {}
    addCell(type, selectedCellId || undefined, init)
  }

  return (
    <div className="notebook">
      {cells.map((c) => (
        <CellView key={c.id} cell={c} />
      ))}
      <div className="add-cell-bar">
        <button className="btn sm" onClick={() => add('sql')}>
          + SQL
        </button>
        <button className="btn sm" onClick={() => add('python')}>
          + Python
        </button>
        <button className="btn sm" onClick={() => add('chart')}>
          + Chart
        </button>
        <button className="btn sm" onClick={() => add('profile')}>
          + Profile
        </button>
        <button className="btn sm" onClick={() => add('stress')} title="Stress-test a transform with adversarial data">
          + Stress-test
        </button>
        <button className="btn sm" onClick={() => add('model')} title="Train & evaluate a model with baseline gate + stress-test">
          + Model
        </button>
        <button className="btn sm" onClick={() => add('experiments')} title="Compare all logged model runs">
          + Experiments
        </button>
        <button className="btn sm" onClick={() => add('markdown')}>
          + Markdown
        </button>
      </div>
    </div>
  )
}
