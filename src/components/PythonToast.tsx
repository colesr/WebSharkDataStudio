import { useStore } from '../state/store'

export function PythonToast() {
  const stage = useStore((s) => s.pythonStage)
  if (!stage) return null
  return (
    <div className="py-toast">
      <span className="spinner" />
      <span>{stage}</span>
    </div>
  )
}
