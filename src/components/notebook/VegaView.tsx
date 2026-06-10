import { useEffect, useRef } from 'react'

// Lazy-load vega-embed to keep it out of the initial bundle critical path.
export function VegaView({ spec }: { spec: unknown }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let view: { finalize: () => void } | null = null
    ;(async () => {
      if (!ref.current || !spec) return
      const embed = (await import('vega-embed')).default
      if (cancelled || !ref.current) return
      try {
        const result = await embed(ref.current, spec as any, {
          actions: false,
          theme: 'dark',
          renderer: 'canvas',
        })
        view = result.view
      } catch (err) {
        if (ref.current) {
          ref.current.innerHTML = `<div class="out-error">Chart error: ${
            (err as Error).message
          }</div>`
        }
      }
    })()
    return () => {
      cancelled = true
      view?.finalize()
    }
  }, [spec])

  return <div className="vega-host" ref={ref} />
}
