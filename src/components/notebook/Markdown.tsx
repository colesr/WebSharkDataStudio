import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(source || '', { async: false }) as string
    return DOMPurify.sanitize(raw)
  }, [source])
  return <div className="md-render" dangerouslySetInnerHTML={{ __html: html }} />
}
