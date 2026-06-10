import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { sql } from '@codemirror/lang-sql'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'

type Lang = 'sql' | 'python' | 'markdown'

function langExt(lang: Lang) {
  if (lang === 'sql') return sql()
  if (lang === 'python') return python()
  return markdown()
}

interface Props {
  value: string
  lang: Lang
  onChange: (value: string) => void
  onRun?: () => void
}

export function Editor({ value, lang, onChange, onRun }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langComp = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  onChangeRef.current = onChange
  onRunRef.current = onRun

  useEffect(() => {
    if (!hostRef.current) return
    const runKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onRunRef.current?.()
          return true
        },
      },
      {
        key: 'Shift-Enter',
        run: () => {
          onRunRef.current?.()
          return true
        },
      },
    ])

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        langComp.current.of(langExt(lang)),
        runKeymap,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.theme(
          {
            '&': { color: 'var(--text)', backgroundColor: 'transparent' },
            '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
            '.cm-cursor': { borderLeftColor: 'var(--accent)' },
            '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
            '.cm-selectionBackground, ::selection': {
              backgroundColor: 'rgba(45,212,191,0.20) !important',
            },
            '.cm-gutters': { backgroundColor: 'transparent' },
          },
          { dark: true },
        ),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconfigure language when it changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langComp.current.reconfigure(langExt(lang)),
    })
  }, [lang])

  // Sync external value changes (e.g. project load) without clobbering edits.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <div className="cell-editor" ref={hostRef} />
}
