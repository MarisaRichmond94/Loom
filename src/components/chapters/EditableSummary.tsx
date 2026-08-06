'use client'

import { useEffect, useRef, useState } from 'react'

// The writer's summary for a branch chapter, edited in place (LOOM-120).
//
// Only branch chapters get this. Every canon chapter's summary belongs to
// WriteAI's outline card — machine-written, refreshed by enrichment, and joined
// here READ-ONLY. Offering an editor over that text would write Loom's copy
// into a field WriteAI owns and overwrites, so the two are deliberately
// different affordances rather than one uniform one.
//
// Saves on BLUR, not per keystroke: a card summary is written in one sitting,
// and a PUT per character would be a write amplifier on the one endpoint in
// this tab that writes at all. Escape reverts and gives the field back.

export default function EditableSummary({
  chapterId,
  initial,
  disabled = false,
  onSaved,
}: {
  chapterId: string
  initial: string
  /** The card is filtered out. Inert: not focusable, not editable, and not
   *  scrollable — a de-emphasised card that still takes the pointer reads as
   *  an active one. */
  disabled?: boolean
  /** Lets the tab hold the saved text without re-fetching the whole book. */
  onSaved: (body: string) => void
}) {
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  // What is actually persisted — the comparison point for "did this change?"
  // and the value Escape restores.
  const savedRef = useRef(initial)
  /**
   * The current text, mirrored synchronously.
   *
   * `onBlur` must not read `value` from its render closure: Escape reverts and
   * then calls blur() in the same handler, so the closure still holds the text
   * Escape just discarded and the field saves precisely what the writer
   * cancelled. A ref is updated before blur runs; state is not.
   */
  const valueRef = useRef(initial)

  function set(next: string) {
    valueRef.current = next
    setValue(next)
  }

  // Follow the prop when the tab reloads the book under us (a refresh, or
  // switching books with this tab open).
  useEffect(() => {
    set(initial)
    savedRef.current = initial
  }, [initial, chapterId])

  async function save(next: string) {
    if (next === savedRef.current) return
    setState('saving')
    try {
      const res = await fetch(`/api/chapters/${chapterId}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: next }),
      })
      if (!res.ok) {
        setState('error')
        return
      }
      const data = await res.json().catch(() => null)
      const stored = typeof data?.body === 'string' ? data.body : next
      // Trust the response: the endpoint deletes the row for an all-whitespace
      // body and answers with '', so local state would otherwise keep the
      // spaces the server just discarded.
      savedRef.current = stored
      set(stored)
      setState('idle')
      onSaved(stored)
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <textarea
        value={value}
        disabled={disabled}
        onChange={e => {
          set(e.target.value)
          if (state === 'error') setState('idle')
        }}
        // Reads the ref, not `value` — see valueRef.
        onBlur={() => void save(valueRef.current)}
        onKeyDown={e => {
          // Escape reverts rather than saving — the standard way out of a field
          // you did not mean to change.
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            set(savedRef.current)
            setState('idle')
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
        placeholder="Add a summary…"
        aria-label="Chapter summary"
        className={`min-h-0 w-full flex-1 resize-none rounded border border-transparent bg-transparent text-[11px] leading-relaxed text-ink-faint outline-none transition placeholder:italic placeholder:text-ink-faint ${
          disabled
            ? // overflow-hidden, not just disabled: a disabled textarea still
              // scrolls under a wheel event in some browsers, and the whole
              // point is that a filtered-out card does not move.
              'cursor-default overflow-hidden'
            : 'overflow-y-auto hover:border-accent/20 focus:border-accent/40 focus:bg-surface-overlay/30 focus:text-ink'
        }`}
      />
      {state !== 'idle' && (
        <span
          className={`shrink-0 pt-0.5 text-[9px] ${state === 'error' ? 'text-choice-kill' : 'text-ink-faint italic'}`}
        >
          {state === 'saving' ? 'Saving…' : 'Could not save — your text is still here.'}
        </span>
      )}
    </div>
  )
}
