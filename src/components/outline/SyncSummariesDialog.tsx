'use client'

import { useEffect, useState } from 'react'
import { htmlToParagraphs } from '@/lib/outlineCards'

// Bulk "use the AI summary" for the outline board.
//
// This REPLACES summaries the writer wrote, so it is built to be deliberate:
// nothing is selected when it opens, each row shows both versions side by side,
// and the confirm button says exactly how many will be replaced. Only chapters
// that actually have something to switch to are listed — a card already showing
// WriteAI's text, or one WriteAI has nothing for, is not a candidate.

export type SyncCandidate = {
  chapterId: string
  title: string
  /** The writer's summary, HTML. */
  mineHtml: string
  /** WriteAI's summary, HTML. */
  aiHtml: string
}

const preview = (html: string) => htmlToParagraphs(html).join(' ')

export default function SyncSummariesDialog({
  candidates,
  aiAvailable,
  busy,
  onConfirm,
  onCancel,
}: {
  candidates: SyncCandidate[]
  /** False when WriteAI has no summaries for this book at all (never analysed,
   *  or not reachable) — said outright rather than shown as an empty list. */
  aiAvailable: boolean
  busy: boolean
  onConfirm: (chapterIds: string[]) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const allSelected = candidates.length > 0 && selected.size === candidates.length
  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60"
      style={{ paddingTop: 'calc(60px + 6vh)', paddingLeft: '14rem' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sync summaries"
        className="relative mx-8 flex max-h-[75vh] w-full max-w-3xl flex-col rounded-xl border border-accent/20 bg-surface-raised p-8 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onCancel} aria-label="Close" className="absolute right-4 top-4 text-lg leading-none text-ink-faint hover:text-ink">✕</button>
        <h2 className="mb-2 pr-6 text-base font-bold text-ink">Sync with AI-generated summaries</h2>

        {!aiAvailable ? (
          <p className="mb-6 text-sm italic text-ink-muted">
            WriteAI has no summaries for this book — it hasn’t analysed it yet, or isn’t reachable
            right now. Chapters without a summary of yours will pick up WriteAI’s automatically once
            it has one.
          </p>
        ) : candidates.length === 0 ? (
          <p className="mb-6 text-sm italic text-ink-muted">
            Nothing to sync. Every chapter that has an AI-generated summary is already showing it, so
            none of your own summaries would change.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm leading-relaxed text-ink-muted">
              These chapters show a summary <span className="font-semibold text-ink">you wrote</span>.
              Syncing one replaces your summary with WriteAI’s, and it will keep updating as WriteAI
              re-analyses the chapter. <span className="font-semibold text-ink">Your summary is removed
              and can’t be brought back.</span>
            </p>
            <label className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(candidates.map(c => c.chapterId)))
                }
              />
              Select all ({candidates.length})
            </label>
            <ul className="mb-6 min-h-0 flex-1 divide-y divide-accent/10 overflow-y-auto rounded-lg border border-accent/10">
              {candidates.map(c => (
                <li key={c.chapterId} className="px-3 py-2.5">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(c.chapterId)}
                      onChange={() => toggle(c.chapterId)}
                      aria-label={`Sync ${c.title}`}
                    />
                    <div className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      <span className="col-span-2 font-semibold text-ink">{c.title}</span>
                      <span className="text-ink-faint">Yours</span>
                      <span className="line-clamp-2 text-ink-muted">{preview(c.mineHtml)}</span>
                      <span className="text-emerald-400">AI</span>
                      <span className="line-clamp-2 text-ink-muted">{preview(c.aiHtml)}</span>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-ink-muted transition hover:text-ink">
            {candidates.length === 0 || !aiAvailable ? 'Close' : 'Cancel'}
          </button>
          {aiAvailable && candidates.length > 0 && (
            <button
              onClick={() => onConfirm([...selected])}
              disabled={busy || selected.size === 0}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Replace {selected.size} summar{selected.size === 1 ? 'y' : 'ies'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
