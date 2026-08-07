'use client'

import { useEffect, useState } from 'react'
import { LuVolumeX, LuX } from 'react-icons/lu'

/**
 * Shown when a republish would send chapters out silent (LOOM-136).
 *
 * ON CLICK, NOT ON THE PAGE. The series page does not carry a permanent
 * warning — the check runs when Republish is pressed, and this appears only if
 * there is something to say. Most of the time there will not be: the nightly
 * sweep now warms canon variants, so gaps close on their own overnight.
 *
 * Three ways out, deliberately. Generating can take minutes per chapter, and
 * blocking a typo fix behind twenty minutes of synthesis would earn a bypass
 * within a week — so "Publish anyway" is a first-class choice, not a trap door.
 */

export type SilentChapter = { book: string; label: string; chapterId: string }

export default function SilentChaptersDialog({
  seriesId,
  bookId,
  chapters,
  onPublishAnyway,
  onClose,
}: {
  seriesId: string
  bookId: string
  chapters: SilentChapter[]
  /** Called when the author chooses to publish regardless, or once audio is done. */
  onPublishAnyway: () => void
  onClose: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const [remaining, setRemaining] = useState(chapters.length)
  const [current, setCurrent] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // Esc closes, like every other dialog in Loom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generating) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generating, onClose])

  async function generate() {
    setGenerating(true)
    setFailed(null)
    // One chapter per request: synthesis is minutes each, so a single call
    // would hang for an hour and lose everything if it dropped. This way the
    // progress is real and the work already done survives a cancel.
    for (;;) {
      const res = await fetch(
        `/api/narration/backfill?seriesId=${seriesId}&bookId=${bookId}`,
        { method: 'POST' },
      )
      const data = await res.json().catch(() => null) as
        { done?: boolean; chapter?: string; remaining?: number; failed?: boolean } | null

      if (!data || data.failed || !res.ok) {
        setFailed(data?.chapter ?? 'a chapter')
        setGenerating(false)
        return
      }
      if (data.done) break
      setCurrent(data.chapter ?? null)
      setRemaining(data.remaining ?? 0)
    }
    setGenerating(false)
    onPublishAnyway()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
      <div className="w-full max-w-lg rounded-lg bg-surface-raised border border-accent/20 shadow-xl">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-accent/10">
          <LuVolumeX size={18} className="text-accent/80 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-ink">
              {chapters.length} chapter{chapters.length === 1 ? '' : 's'} would publish without audio
            </h2>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              Their recordings don’t match the current prose, so publishing now sends the text
              without narration.
            </p>
          </div>
          {!generating && (
            <button onClick={onClose} aria-label="Close" className="shrink-0 p-1 rounded text-ink-faint hover:text-ink transition">
              <LuX size={15} />
            </button>
          )}
        </div>

        <div className="px-5 py-3 max-h-48 overflow-y-auto">
          <ul className="flex flex-col gap-1">
            {chapters.map(c => (
              <li key={c.chapterId} className="text-xs text-ink-muted">
                {c.book} — {c.label}
              </li>
            ))}
          </ul>
        </div>

        {generating && (
          <div className="px-5 pb-2">
            <p className="text-xs text-ink-muted">
              Generating{current ? ` ${current}` : ''}… {remaining} left. This takes a few minutes each.
            </p>
          </div>
        )}
        {failed && (
          <div className="px-5 pb-2">
            <p className="text-xs text-choice-kill">
              {failed} failed to generate. Anything already finished has been kept.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-accent/10">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onPublishAnyway}
            disabled={generating}
            className="px-3 py-1.5 rounded text-xs border border-accent/20 bg-surface-overlay text-ink-muted hover:text-ink transition disabled:opacity-40"
          >
            Publish anyway
          </button>
          <button
            onClick={() => void generate()}
            disabled={generating}
            className="px-3 py-1.5 rounded text-xs border border-accent bg-accent text-white hover:opacity-90 transition disabled:opacity-40"
          >
            {generating ? 'Generating…' : 'Generate audio, then publish'}
          </button>
        </div>
      </div>
    </div>
  )
}
