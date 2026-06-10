import { useEffect, useRef, useState } from 'react'
import { useActivity, type LogEntry } from '../state/activity'

function clock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  info: 'var(--text-dim)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  error: 'var(--err)',
}

/** Thin indeterminate progress bar at the very top, shown while busy. */
export function TopProgress() {
  const busy = useActivity((s) => s.busy)
  return <div className={`top-progress ${busy > 0 ? 'on' : ''}`} aria-hidden />
}

/** Bottom activity console: slim status bar that expands upward into a log. */
export function ActivityConsole() {
  const log = useActivity((s) => s.log)
  const busy = useActivity((s) => s.busy)
  const clearLog = useActivity((s) => s.clearLog)
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const latest = log.length ? log[log.length - 1] : null

  // Auto-scroll to the newest line while the log is open.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [log, open])

  return (
    <div className="activity">
      {open && (
        <div className="activity-log" ref={scrollRef}>
          {log.length === 0 && <div className="activity-empty">No activity yet.</div>}
          {log.map((e) => (
            <div className="log-line" key={e.id}>
              <span className="log-time">{clock(e.ts)}</span>
              <span style={{ color: LEVEL_COLOR[e.level] }}>{e.msg}</span>
            </div>
          ))}
        </div>
      )}

      <div className="activity-bar" onClick={() => setOpen((v) => !v)}>
        {busy > 0 ? <span className="spinner" /> : <span className="activity-idle-dot" />}
        <span className="activity-label">Activity</span>
        <span className="activity-current">{latest ? latest.msg : 'idle'}</span>
        <span style={{ flex: 1 }} />
        {log.length > 0 && (
          <button
            className="btn sm ghost"
            onClick={(e) => {
              e.stopPropagation()
              clearLog()
            }}
          >
            clear
          </button>
        )}
        <span className="activity-chevron">{open ? '⌄' : '⌃'}</span>
      </div>
    </div>
  )
}
