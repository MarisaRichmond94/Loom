'use client'

import { useEffect, useState } from 'react'
import { LuX, LuPencilLine } from 'react-icons/lu'

import type { Citation } from './types'

// The cited passage, in its chapter (LOOM-115).
//
// A citation on its own is a claim; the paragraphs around it are what make the
// claim checkable. So the viewer loads the whole chapter and marks the cited
// chunk within it, rather than showing the chunk alone.
//
// Text comes from `GET /api/books/{n}/chapters/{c}/text`, which was VERIFIED as
// a pure read before wiring — the sibling `/api/plan/*` GETs write to disk, so
// "it is a GET" is not an argument, and this runs on every citation click.

export default function ExploreChapterViewer({
  citation, bookNumber, editorHref, onClose,
}: {
  citation: Citation
  bookNumber: number | null
  editorHref: string | null
  onClose: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (bookNumber === null) { setState('error'); return }
    let cancelled = false
    setState('loading')
    setText(null)

    fetch(`/api/writeai/chat/chapter?book=${bookNumber}&chapter=${citation.chapter}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { text?: string }) => {
        if (cancelled) return
        setText(d.text ?? '')
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('error') })

    return () => { cancelled = true }
  }, [bookNumber, citation.chapter, citation.chunk_index])

  const chapterLabel = citation.chapter === 0 ? 'Prologue' : `Chapter ${citation.chapter}`

  // The cited chunk, located in the full chapter so it can be marked in place.
  const needle = (citation.text || citation.snippet || '').trim().slice(0, 400)
  const paragraphs = (text ?? '').split('\n\n').filter(p => p.trim())
  const hitIndex = needle
    ? paragraphs.findIndex(p => needle.includes(p.trim().slice(0, 60)) || p.includes(needle.slice(0, 60)))
    : -1

  return (
    <div className="flex h-full w-full flex-col border-l border-accent/15 bg-surface-base">
      <div className="flex items-start justify-between gap-2 border-b border-accent/10 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink">
            {citation.book} · {chapterLabel}
          </p>
          {citation.pov && (
            <p className="text-[10px] text-ink-faint">POV: {citation.pov}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-surface-overlay hover:text-ink"
        >
          <LuX size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {state === 'loading' && (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-3 rounded bg-surface-muted animate-pulse"
                style={{ width: `${70 + ((i * 13) % 28)}%` }} />
            ))}
          </div>
        )}
        {state === 'error' && (
          <p className="text-xs leading-relaxed text-ink-faint">
            {bookNumber === null
              ? 'WriteAI has no index for this book, so the passage cannot be shown.'
              : 'That chapter could not be loaded. It may have been renumbered since the last sync.'}
          </p>
        )}
        {state === 'ready' && (
          paragraphs.length === 0 ? (
            <p className="text-xs text-ink-faint">This chapter is empty in the index.</p>
          ) : (
            <div className="space-y-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  className={i === hitIndex ? 'rounded bg-accent/20 px-1 py-0.5 text-ink' : undefined}
                  ref={i === hitIndex
                    ? el => el?.scrollIntoView({ block: 'center' })
                    : undefined}
                >
                  {p}
                </p>
              ))}
            </div>
          )
        )}
      </div>

      <div className="border-t border-accent/10 p-2.5">
        {editorHref ? (
          <a
            href={editorHref}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-accent/25 bg-surface-raised px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent"
          >
            <LuPencilLine size={11} /> Open in the editor
          </a>
        ) : (
          // Visible but unlinked, with the reason. Dropping the action would
          // hide that the index and the manuscript disagree, which is exactly
          // what the writer wants to know.
          <p className="text-center text-[10px] leading-relaxed text-ink-faint">
            Loom can’t resolve this chapter — it may have been renumbered since
            the last sync.
          </p>
        )}
      </div>
    </div>
  )
}
