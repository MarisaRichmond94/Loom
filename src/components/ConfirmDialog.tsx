'use client'

import { useEffect, useRef } from 'react'

// Tiny modal for confirming destructive edits. The confirm button is
// autofocused so the writer can press Enter to accept; ESC cancels.
// Clicking the backdrop also cancels. Used by every editor surface that
// can delete content (blocks, conditional overrides, etc.).
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Focus the confirm button on open so Enter immediately accepts. The
  // ref-based focus runs after the modal mounts so the button is in the
  // DOM and focusable.
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => confirmRef.current?.focus())
  }, [open])

  // ESC anywhere cancels.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="bg-surface-raised border border-accent/20 rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-ink mb-2">{title}</h2>
        {message && <p className="text-sm text-ink-muted mb-4">{message}</p>}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-ink-muted hover:text-ink transition"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="px-4 py-1.5 rounded text-xs bg-choice-kill text-white font-medium hover:opacity-90 transition focus:ring-2 focus:ring-choice-kill/50 focus:outline-none"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
