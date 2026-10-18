'use client'

import { useEffect } from 'react'

// The "Delete chapter?" modal — shared by the chapter page's action menu and
// the book page's outline board, so deleting a chapter reads and behaves the
// same wherever it is started. Lifted verbatim from the chapter page.
//
// Deliberately NOT the small ConfirmDialog: that one autofocuses its confirm
// button so Enter accepts, which is right for removing a block and wrong for
// destroying a chapter's prose. Here nothing is focused for you; the writer has
// to aim at Delete.

export default function DeleteChapterDialog({
  title,
  onConfirm,
  onCancel,
  busy = false,
}: {
  /** The chapter's title, quoted in the heading. */
  title: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  // ESC cancels, matching every other modal in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
      style={{ paddingTop: 'calc(60px + 10vh)', paddingLeft: '14rem' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete "${title}"?`}
        className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onCancel} aria-label="Close" className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none">✕</button>
        <h2 className="text-base font-bold text-ink mb-3 pr-6">Delete &quot;{title}&quot;?</h2>
        <p className="text-sm text-ink-muted mb-6 leading-relaxed italic">
          Deleting this chapter is permanent and cannot be undone. All written content, blocks,
          and choices will be removed. Any story branches dependent on choices here will fall back
          to default text. Subsequent chapter numbers will be updated automatically.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-choice-kill text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
