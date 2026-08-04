'use client'

import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { LuX } from 'react-icons/lu'
import type { OutlineCard } from '@/lib/writerOutline'

// The outline card editor (LOOM-97).
//
// Five writer-owned fields. Everything else on the card — `loom_id`,
// `summary_source`, `extracted_bullets`, `chapter`, `status`, `position` — is
// untouched here and carried through by the caller, which spreads changes over
// the existing card rather than rebuilding it.

export default function OutlineCardModal({
  card,
  label,
  onSave,
  onClose,
}: {
  card: OutlineCard
  /** The card's computed label, for the dialog title. */
  label: string
  /** Resolves false when the save was refused or WriteAI was unreachable, so
   *  the dialog can stay open on a failure rather than closing over a change
   *  that never landed. */
  onSave: (changes: Partial<OutlineCard>) => Promise<boolean>
  onClose: () => void
}) {
  const [heading, setHeading] = useState(card.heading)
  const [pov, setPov] = useState(card.pov)
  const [date, setDate] = useState(card.date ?? '')
  const [notes, setNotes] = useState(card.notes ?? '')
  const [saving, setSaving] = useState(false)

  /**
   * The summary is HTML in the store, so it is edited as rich text.
   *
   * ⚠️ The round-trip is NOT lossless, and that matters more than it looks.
   * TipTap re-serialises on load: `&#x27;` becomes `'`, attribute order can
   * shift, empty paragraphs collapse. WriteAI decides whether a summary is
   * still machine-written by comparing `writer_summary` to `summary_source`
   * EXACTLY — so a card opened and closed without a single keystroke would,
   * naively, come back looking hand-edited and stop being refreshed.
   *
   * `pristineRef` is the fix: the editor's own serialisation of the ORIGINAL
   * content, captured once. If the writer never changes anything, the save
   * sends back the original string untouched rather than TipTap's rendering
   * of it.
   */
  const pristineRef = useRef<string | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'What happens in this chapter?' }),
    ],
    content: card.writer_summary || '',
    editorProps: {
      attributes: {
        spellcheck: 'true',
        class: 'outline-summary-editor focus:outline-none',
      },
    },
    onCreate: ({ editor }) => {
      pristineRef.current = editor.getHTML()
    },
  })

  // ESC closes, matching every other dialog here.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    if (saving) return
    setSaving(true)

    const current = editor?.getHTML() ?? card.writer_summary
    // Unchanged means unchanged: send back exactly what was stored, not a
    // re-rendering of it. See pristineRef above.
    const summaryUntouched = pristineRef.current !== null && current === pristineRef.current
    const writer_summary = summaryUntouched ? card.writer_summary : current

    try {
      const ok = await onSave({
        heading: heading.trim(),
        pov: pov.trim(),
        // Empty means "no date", which the store spells as null rather than "".
        date: date.trim() === '' ? null : date.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
        writer_summary,
      })
      // Stay open on failure. Closing over a save that did not land loses the
      // writer's edit with nothing but a small red line to explain it.
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full rounded bg-surface-overlay border border-accent/15 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint/60 focus:border-accent/40 focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-accent/20 bg-surface-raised shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-accent/10 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink">{label}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-faint transition hover:text-ink"
          >
            <LuX size={16} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              Heading
            </span>
            <input
              value={heading}
              onChange={e => setHeading(e.target.value)}
              placeholder="Chapter heading"
              className={field}
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                POV
              </span>
              <input
                value={pov}
                onChange={e => setPov(e.target.value)}
                placeholder="Whose eyes"
                className={field}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                Story date
              </span>
              {/* Free text, not a date picker. These are STORY dates —
                  "Saturday, October 31st" — carrying no year by design, which is
                  what chapter_timeline parses. A calendar widget would insist on
                  a year the story does not have. */}
              <input
                value={date}
                onChange={e => setDate(e.target.value)}
                placeholder="Saturday, October 31st"
                className={field}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              Summary
            </span>
            <div className="rounded border border-accent/15 bg-surface-overlay px-2.5 py-2 text-sm leading-relaxed text-ink [&_p]:mb-2 [&_p:last-child]:mb-0">
              <EditorContent editor={editor} />
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything to remember about this chapter"
              className={`${field} resize-y`}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-accent/10 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
